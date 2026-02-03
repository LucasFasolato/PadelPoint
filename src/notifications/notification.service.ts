import { Injectable } from '@nestjs/common';
import { NotificationEvent } from './notification-event.entity';

@Injectable()
export class NotificationService {
  dispatch(event: NotificationEvent) {
    const payload = JSON.stringify(event.payload);

    console.log(
      `[NOTIFICATION MOCK] type=${event.type} channel=${event.channel} reservationId=${event.reservationId} payload=${payload}`,
    );
  }
}
