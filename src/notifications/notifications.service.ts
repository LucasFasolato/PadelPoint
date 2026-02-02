import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Notification,
  NotificationChannel,
  NotificationStatus,
} from './notification.entity';

type ReservationForNotif = {
  id: string;
  startAt: Date;
  endAt: Date;
  clienteNombre: string;
  clienteEmail: string | null;
  clienteTelefono: string | null;
  court: {
    nombre: string;
    club: {
      nombre: string;
      direccion?: string | null;
    };
  };
};

function normalizePhone(raw: string): string {
  // mock: dejamos solo dígitos, y si viene 341..., lo convertimos a AR +54
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // si ya trae +54… lo dejamos
  if (digits.startsWith('54')) return digits;
  // heurística simple: si parece celular local, anteponemos 54
  return `54${digits}`;
}

function buildWhatsAppLink(phoneDigits: string, text: string): string {
  const base = phoneDigits ? `https://wa.me/${phoneDigits}` : `https://wa.me/`;
  return `${base}?text=${encodeURIComponent(text)}`;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  async getLatestForReservation(reservationId: string) {
    const rows = await this.repo.find({
      where: { reservationId } as any,
      order: { createdAt: 'DESC' } as any,
      take: 20,
    });

    const byChannel = new Map<NotificationChannel, Notification>();

    for (const n of rows) {
      if (!byChannel.has(n.channel)) byChannel.set(n.channel, n);
    }

    const email = byChannel.get(NotificationChannel.EMAIL);
    const whatsapp = byChannel.get(NotificationChannel.WHATSAPP);

    return {
      email: email
        ? {
            status: email.status,
            sentAt: email.createdAt.toISOString(),
          }
        : null,
      whatsapp: whatsapp
        ? {
            status: whatsapp.status,
            sentAt: whatsapp.createdAt.toISOString(),
            link:
              ((whatsapp.payload as Record<string, unknown> | null)?.[
                'link'
              ] as string | null) ?? null,
          }
        : null,
    };
  }

  async sendReservationConfirmedMock(res: ReservationForNotif) {
    // ⚡ No tiramos errores al flujo de confirmación.
    // Si falla notificación, confirmación sigue OK, solo registramos FAILED.

    const startIso = res.startAt.toISOString();
    const endIso = res.endAt.toISOString();

    const messageText =
      `✅ Reserva confirmada\n` +
      `Club: ${res.court.club.nombre}\n` +
      `${res.court.club.direccion ? `Dir: ${res.court.club.direccion}\n` : ''}` +
      `Cancha: ${res.court.nombre}\n` +
      `Inicio: ${startIso}\n` +
      `Fin: ${endIso}\n` +
      `A nombre de: ${res.clienteNombre}\n` +
      `ID: ${res.id}`;

    // EMAIL (mock)
    if (res.clienteEmail) {
      try {
        const n = this.repo.create({
          reservationId: res.id,
          channel: NotificationChannel.EMAIL,
          to: res.clienteEmail,
          status: NotificationStatus.SENT,
          provider: 'MOCK',
          payload: {
            subject: 'Reserva confirmada',
            text: messageText,
          },
        });
        await this.repo.save(n);

        // opcional: log útil para dev
        // eslint-disable-next-line no-console
        console.log(
          `[MOCK EMAIL SENT] to=${res.clienteEmail} reservation=${res.id}`,
        );
      } catch (e: any) {
        await this.repo.save(
          this.repo.create({
            reservationId: res.id,
            channel: NotificationChannel.EMAIL,
            to: res.clienteEmail,
            status: NotificationStatus.FAILED,
            provider: 'MOCK',
            errorMessage: e?.message ?? 'unknown error',
          }),
        );
      }
    }

    // WHATSAPP (mock) => generamos link clickeable
    try {
      const phone = res.clienteTelefono
        ? normalizePhone(res.clienteTelefono)
        : '';
      const link = buildWhatsAppLink(phone, messageText);

      const n = this.repo.create({
        reservationId: res.id,
        channel: NotificationChannel.WHATSAPP,
        to: phone || null,
        status: NotificationStatus.SENT,
        provider: 'MOCK',
        payload: { link, text: messageText },
      });
      await this.repo.save(n);

      // eslint-disable-next-line no-console
      console.log(
        `[MOCK WHATSAPP READY] to=${phone || '(no phone)'} reservation=${res.id}`,
      );
    } catch (e: any) {
      await this.repo.save(
        this.repo.create({
          reservationId: res.id,
          channel: NotificationChannel.WHATSAPP,
          to: res.clienteTelefono ?? null,
          status: NotificationStatus.FAILED,
          provider: 'MOCK',
          errorMessage: e?.message ?? 'unknown error',
        }),
      );
    }

    // devolver estado actual
    return this.getLatestForReservation(res.id);
  }
}
