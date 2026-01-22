import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { PaymentIntent } from './payment-intent.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { PaymentEvent } from './payment-event.entity';

import { PaymentIntentStatus } from './enums/payment-intent-status.enum';
import { PaymentProvider } from './enums/payment-provider.enum';
import { PaymentReferenceType } from './enums/payment-reference-type.enum';
import { PaymentTransactionStatus } from './enums/payment-transaction-status.enum';

import {
  Reservation,
  ReservationStatus,
} from '../modules/reservations/reservation.entity';

type JsonObject = Record<string, any>;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,

    @InjectRepository(PaymentIntent)
    private readonly intentRepo: Repository<PaymentIntent>,

    @InjectRepository(PaymentTransaction)
    private readonly txRepo: Repository<PaymentTransaction>,

    @InjectRepository(PaymentEvent)
    private readonly eventRepo: Repository<PaymentEvent>,

    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
  ) {}

  private computeExpiresAt(minutes = 15): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  private validateReservationOwnershipOrToken(args: {
    reservation: Reservation;
    userId: string;
    checkoutToken?: string;
    publicCheckout?: boolean;
  }) {
    if (args.publicCheckout) {
      if (!args.checkoutToken)
        throw new BadRequestException('checkoutToken is required');
      if (!args.reservation.checkoutToken)
        throw new BadRequestException('Reservation has no checkoutToken');
      if (args.reservation.checkoutToken !== args.checkoutToken) {
        throw new ForbiddenException('Invalid checkoutToken');
      }
    }
  }

  async createIntent(input: {
    userId: string;
    referenceType: PaymentReferenceType;
    referenceId: string;
    currency?: string;
    checkoutToken?: string;
    publicCheckout?: boolean;
  }) {
    const currency = (input.currency ?? 'ARS').toUpperCase();

    // Idempotencia
    const existing = await this.intentRepo.findOne({
      where: {
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    });
    if (existing) {
      if (!input.publicCheckout && existing.userId !== input.userId)
        throw new ForbiddenException('Not allowed');
      return existing;
    }

    if (input.referenceType !== PaymentReferenceType.RESERVATION) {
      throw new BadRequestException(
        `Unsupported referenceType: ${input.referenceType}`,
      );
    }

    const reservation = await this.reservationRepo.findOne({
      where: { id: input.referenceId },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    this.validateReservationOwnershipOrToken({
      reservation,
      userId: input.userId,
      checkoutToken: input.checkoutToken,
      publicCheckout: input.publicCheckout,
    });

    if (reservation.status === ReservationStatus.HOLD) {
      // Usar getTime() para seguridad en comparaciones
      if (
        !reservation.expiresAt ||
        new Date(reservation.expiresAt).getTime() <= Date.now()
      ) {
        throw new BadRequestException('Reservation hold expired');
      }
    }

    if (reservation.status === ReservationStatus.CONFIRMED) {
      throw new BadRequestException('Reservation is already confirmed');
    }
    if (reservation.status === ReservationStatus.CANCELLED) {
      throw new BadRequestException('Reservation is cancelled');
    }

    // Convertir precio a string con 2 decimales para la DB (numeric/money type)
    const amount = Number(reservation.precio).toFixed(2);

    const intent = this.intentRepo.create({
      userId: input.publicCheckout ? 'public' : input.userId,
      amount,
      currency,
      status: PaymentIntentStatus.PENDING,
      referenceType: PaymentReferenceType.RESERVATION,
      referenceId: reservation.id,
      expiresAt: this.computeExpiresAt(15),
      paidAt: null,
    });

    const saved = await this.intentRepo.save(intent);

    await this.eventRepo.save(
      this.eventRepo.create({
        paymentIntentId: saved.id,
        type: 'CREATED',
        payload: {
          referenceType: saved.referenceType,
          referenceId: saved.referenceId,
          amount: saved.amount,
          currency: saved.currency,
        } satisfies JsonObject,
      }),
    );

    return saved;
  }

  async getIntent(input: { userId: string; intentId: string }) {
    const intent = await this.intentRepo.findOne({
      where: { id: input.intentId },
    });
    if (!intent) throw new NotFoundException('PaymentIntent not found');
    if (intent.userId !== input.userId)
      throw new ForbiddenException('Not allowed');
    return intent;
  }

  async findByReference(input: {
    userId: string;
    referenceType?: string;
    referenceId?: string;
  }) {
    if (!input.referenceType || !input.referenceId) return [];

    const intent = await this.intentRepo.findOne({
      where: {
        referenceType: input.referenceType as PaymentReferenceType,
        referenceId: input.referenceId,
      },
    });
    if (!intent) return [];
    if (intent.userId !== input.userId)
      throw new ForbiddenException('Not allowed');
    return [intent];
  }

  async simulateSuccess(input: {
    userId: string;
    intentId: string;
    checkoutToken?: string;
    publicCheckout?: boolean;
  }) {
    return this.dataSource.transaction(async (manager) => {
      const intentRepo = manager.getRepository(PaymentIntent);
      const txRepo = manager.getRepository(PaymentTransaction);
      const eventRepo = manager.getRepository(PaymentEvent);
      const reservationRepo = manager.getRepository(Reservation);

      const intent = await intentRepo.findOne({
        where: { id: input.intentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!intent) throw new NotFoundException('PaymentIntent not found');

      if (!input.publicCheckout && intent.userId !== input.userId)
        throw new ForbiddenException('Not allowed');

      if (intent.status === PaymentIntentStatus.SUCCEEDED) {
        return { ok: true, intent };
      }

      if (
        intent.status === PaymentIntentStatus.CANCELLED ||
        intent.status === PaymentIntentStatus.EXPIRED
      ) {
        throw new BadRequestException(
          `Cannot pay an intent with status ${intent.status}`,
        );
      }

      if (
        intent.expiresAt &&
        new Date(intent.expiresAt).getTime() < Date.now()
      ) {
        intent.status = PaymentIntentStatus.EXPIRED;
        await intentRepo.save(intent);
        await eventRepo.save(
          eventRepo.create({
            paymentIntentId: intent.id,
            type: 'EXPIRED',
            payload: null,
          }),
        );
        throw new BadRequestException('PaymentIntent expired');
      }

      // Success TX
      const tx = txRepo.create({
        paymentIntentId: intent.id,
        provider: PaymentProvider.SIMULATED,
        providerRef: `sim_${Date.now()}`,
        status: PaymentTransactionStatus.SUCCESS,
        rawResponse: {
          simulated: true,
          result: 'success',
        } satisfies JsonObject,
      });
      await txRepo.save(tx);

      // Intent SUCCEEDED
      intent.status = PaymentIntentStatus.SUCCEEDED;
      intent.paidAt = new Date();
      intent.expiresAt = null;
      await intentRepo.save(intent);

      await eventRepo.save(
        eventRepo.create({
          paymentIntentId: intent.id,
          type: 'SUCCESS',
          payload: { transactionId: tx.id } satisfies JsonObject,
        }),
      );

      // Lógica de negocio (Reservas)
      if (intent.referenceType === PaymentReferenceType.RESERVATION) {
        const reservation = await reservationRepo.findOne({
          where: { id: intent.referenceId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!reservation) throw new NotFoundException('Reservation not found');

        this.validateReservationOwnershipOrToken({
          reservation,
          userId: input.userId,
          checkoutToken: input.checkoutToken,
          publicCheckout: input.publicCheckout,
        });

        if (reservation.status === ReservationStatus.CANCELLED) {
          // Revertir intent
          intent.status = PaymentIntentStatus.CANCELLED;
          await intentRepo.save(intent);
          await eventRepo.save(
            eventRepo.create({
              paymentIntentId: intent.id,
              type: 'CANCELLED_DUE_TO_RESERVATION_CANCELLED',
              payload: { reservationId: reservation.id } satisfies JsonObject,
            }),
          );
          throw new BadRequestException(
            'Reservation is cancelled; cannot confirm',
          );
        }

        if (reservation.status === ReservationStatus.HOLD) {
          reservation.status = ReservationStatus.CONFIRMED;
          reservation.expiresAt = null;
          reservation.checkoutTokenExpiresAt = null;
          reservation.confirmedAt = new Date();
          await reservationRepo.save(reservation);

          await eventRepo.save(
            eventRepo.create({
              paymentIntentId: intent.id,
              type: 'RESERVATION_CONFIRMED',
              payload: { reservationId: reservation.id } satisfies JsonObject,
            }),
          );
        }
      }

      return { ok: true, intent };
    });
  }

  async simulateFailure(input: {
    userId: string;
    intentId: string;
    checkoutToken?: string;
    publicCheckout?: boolean;
  }) {
    return this.dataSource.transaction(async (manager) => {
      const intentRepo = manager.getRepository(PaymentIntent);
      const txRepo = manager.getRepository(PaymentTransaction);
      const eventRepo = manager.getRepository(PaymentEvent);

      const intent = await intentRepo.findOne({
        where: { id: input.intentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!intent) throw new NotFoundException('PaymentIntent not found');

      if (!input.publicCheckout && intent.userId !== input.userId)
        throw new ForbiddenException('Not allowed');

      if (intent.status === PaymentIntentStatus.SUCCEEDED) {
        throw new BadRequestException('Intent already paid');
      }

      if (
        intent.status === PaymentIntentStatus.CANCELLED ||
        intent.status === PaymentIntentStatus.EXPIRED
      ) {
        return { ok: true, intent };
      }

      if (
        intent.expiresAt &&
        new Date(intent.expiresAt).getTime() < Date.now()
      ) {
        intent.status = PaymentIntentStatus.EXPIRED;
        await intentRepo.save(intent);
        await eventRepo.save(
          eventRepo.create({
            paymentIntentId: intent.id,
            type: 'EXPIRED',
            payload: null,
          }),
        );
        return { ok: true, intent };
      }

      const tx = txRepo.create({
        paymentIntentId: intent.id,
        provider: PaymentProvider.SIMULATED,
        providerRef: `sim_${Date.now()}`,
        status: PaymentTransactionStatus.FAILED,
        rawResponse: {
          simulated: true,
          result: 'failure',
        } satisfies JsonObject,
      });
      await txRepo.save(tx);

      intent.status = PaymentIntentStatus.CANCELLED;
      await intentRepo.save(intent);

      await eventRepo.save(
        eventRepo.create({
          paymentIntentId: intent.id,
          type: 'FAILED',
          payload: { transactionId: tx.id } satisfies JsonObject,
        }),
      );

      return { ok: true, intent };
    });
  }

  /**
   * ✅ FIX CRÍTICO:
   * Ahora devuelve SIEMPRE un objeto, incluso si los crons están deshabilitados.
   * Esto evita que el Cron Job crashee con "Cannot read properties of undefined".
   */
  async expirePendingIntentsNow(limit = 200) {
    if (this.configService.get<boolean>('enableCrons') === false) {
      // Retorno seguro por defecto
      return { ok: true, expiredCount: 0, releasedReservations: 0 };
    }

    return this.dataSource.transaction(async (manager) => {
      const intentRepo = manager.getRepository(PaymentIntent);
      const eventRepo = manager.getRepository(PaymentEvent);
      const reservationRepo = manager.getRepository(Reservation);

      const now = new Date();

      const intents = await intentRepo
        .createQueryBuilder('pi')
        .setLock('pessimistic_write')
        .where('pi.status = :status', { status: PaymentIntentStatus.PENDING })
        .andWhere('pi.expiresAt IS NOT NULL')
        .andWhere('pi.expiresAt < :now', { now })
        .orderBy('pi.expiresAt', 'ASC')
        .limit(limit)
        .getMany();

      let expiredCount = 0;
      let releasedReservations = 0;

      for (const intent of intents) {
        intent.status = PaymentIntentStatus.EXPIRED;
        await intentRepo.save(intent);
        expiredCount++;

        await eventRepo.save(
          eventRepo.create({
            paymentIntentId: intent.id,
            type: 'EXPIRED',
            payload: null,
          }),
        );

        if (intent.referenceType === PaymentReferenceType.RESERVATION) {
          const reservation = await reservationRepo.findOne({
            where: { id: intent.referenceId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!reservation) continue;

          if (reservation.status === ReservationStatus.HOLD) {
            reservation.status = ReservationStatus.CANCELLED;
            reservation.expiresAt = null;
            await reservationRepo.save(reservation);
            releasedReservations++;
          }
        }
      }

      return { ok: true, expiredCount, releasedReservations };
    });
  }
}
