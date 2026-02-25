import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import {
  NotificationEvent,
  NotificationEventChannel,
  NotificationEventPayload,
  NotificationEventType,
} from './notification-event.entity';
import { NotificationService } from './notification.service';

type CreateNotificationEventInput = {
  type: NotificationEventType;
  reservationId: string;
  userId: string | null;
  channel: NotificationEventChannel;
  payload: NotificationEventPayload;
};

@Injectable()
export class NotificationEventsService {
  constructor(
    @InjectRepository(NotificationEvent)
    private readonly repo: Repository<NotificationEvent>,
    private readonly notifier: NotificationService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(NotificationEvent) : this.repo;
  }

  async recordEvent(
    input: CreateNotificationEventInput,
    manager?: EntityManager,
  ) {
    const repository = this.getRepo(manager);
    const event = repository.create(input);
    const saved = await repository.save(event);
    this.notifier.dispatch(saved);
    return saved;
  }

  async recordEventIfMissing(
    input: CreateNotificationEventInput,
    manager?: EntityManager,
  ) {
    const repository = this.getRepo(manager);
    const existing = await repository.findOne({
      where: { reservationId: input.reservationId, type: input.type } as any,
    });
    if (existing) return existing;
    return this.recordEvent(input, manager);
  }

  async findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async list(params: {
    type?: NotificationEventType;
    reservationId?: string;
    from?: Date;
    to?: Date;
  }) {
    const qb = this.repo
      .createQueryBuilder('event')
      .orderBy('event.createdAt', 'DESC');

    if (params.type) {
      qb.andWhere('event.type = :type', { type: params.type });
    }
    if (params.reservationId) {
      qb.andWhere('event.reservationId = :reservationId', {
        reservationId: params.reservationId,
      });
    }
    if (params.from) {
      qb.andWhere('event.createdAt >= :from', { from: params.from });
    }
    if (params.to) {
      qb.andWhere('event.createdAt <= :to', { to: params.to });
    }

    return qb.getMany();
  }

  async findLatestForReservation(
    reservationId: string,
    types: NotificationEventType[],
  ) {
    if (!types.length) return null;
    return this.repo
      .createQueryBuilder('event')
      .where('event.reservationId = :reservationId', { reservationId })
      .andWhere('event.type IN (:...types)', { types })
      .orderBy('event.createdAt', 'DESC')
      .getOne();
  }

  async findLatestResendAfter(reservationId: string, from: Date) {
    return this.repo
      .createQueryBuilder('event')
      .where('event.reservationId = :reservationId', { reservationId })
      .andWhere('event.type = :type', {
        type: NotificationEventType.NOTIFICATION_RESEND_REQUESTED,
      })
      .andWhere('event.createdAt >= :from', { from })
      .orderBy('event.createdAt', 'DESC')
      .getOne();
  }
}
