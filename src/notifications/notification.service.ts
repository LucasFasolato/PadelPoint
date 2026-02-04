import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  NotificationEvent,
  NotificationEventType,
} from './notification-event.entity';
import {
  Notification,
  NotificationChannel,
  NotificationStatus,
} from './notification.entity';

type ResendEmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

type ResendResponse = {
  id?: string;
  error?: { message: string };
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly resendApiKey: string | null;
  private readonly fromEmail: string;
  private readonly appUrl: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {
    this.resendApiKey = this.config.get<string>('RESEND_API_KEY') || null;
    this.fromEmail =
      this.config.get<string>('EMAIL_FROM') ||
      'PadelPoint <noreply@padelpoint.app>';
    this.appUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000';

    if (!this.resendApiKey) {
      this.logger.warn(
        'RESEND_API_KEY not configured - emails will be logged but not sent',
      );
    }
  }

  dispatch(event: NotificationEvent) {
    // Solo procesamos eventos de confirmación por ahora
    if (event.type !== NotificationEventType.RESERVATION_CONFIRMED) {
      this.logger.debug(`Skipping notification for event type: ${event.type}`);
      return;
    }

    const payload = event.payload;
    if (!payload) {
      this.logger.warn(`Event ${event.id} has no payload`);
      return;
    }

    // Necesitamos el email del cliente - lo buscamos de la reserva
    // Por ahora asumimos que viene en el payload o lo obtenemos de otro lado
    // Como el payload no tiene email, vamos a tener que extenderlo o buscarlo

    // NOTA: Idealmente extenderíamos NotificationEventPayload para incluir
    // clienteEmail, clienteNombre, courtName, clubName, etc.
    // Por ahora, hacemos un dispatch "fire and forget" con la info que tenemos

    this.logger.log(
      `[DISPATCH] type=${event.type} reservationId=${event.reservationId}`,
    );
  }

  /**
   * Envía email de confirmación de reserva
   * Llamar después de confirmar la reserva, con todos los datos necesarios
   */
  async sendReservationConfirmedEmail(data: {
    reservationId: string;
    clienteEmail: string;
    clienteNombre: string;
    courtName: string;
    clubName: string;
    clubDireccion?: string | null;
    startAt: Date;
    endAt: Date;
    precio: number;
    receiptToken: string;
  }) {
    const to = data.clienteEmail;

    // Formatear fecha y hora
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Argentina/Cordoba',
    };
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Argentina/Cordoba',
    };

    const dateStr = data.startAt.toLocaleDateString('es-AR', dateOptions);
    const startTime = data.startAt.toLocaleTimeString('es-AR', timeOptions);
    const endTime = data.endAt.toLocaleTimeString('es-AR', timeOptions);

    const receiptUrl = `${this.appUrl}/checkout/success/${data.reservationId}?receiptToken=${encodeURIComponent(data.receiptToken)}`;

    const html = this.buildConfirmationEmailHtml({
      clienteNombre: data.clienteNombre,
      clubName: data.clubName,
      clubDireccion: data.clubDireccion,
      courtName: data.courtName,
      dateStr,
      startTime,
      endTime,
      precio: data.precio,
      receiptUrl,
      reservationId: data.reservationId,
    });

    const subject = `✅ Reserva confirmada - ${data.clubName}`;

    // Registrar intento
    const notification = this.notificationRepo.create({
      reservationId: data.reservationId,
      channel: NotificationChannel.EMAIL,
      to,
      status: NotificationStatus.QUEUED,
      provider: this.resendApiKey ? 'RESEND' : 'MOCK',
      payload: { subject, text: `Reserva confirmada para ${dateStr}` },
    });

    try {
      if (this.resendApiKey) {
        // Enviar con Resend
        const result = await this.sendWithResend({
          from: this.fromEmail,
          to,
          subject,
          html,
        });

        if (result.error) {
          notification.status = NotificationStatus.FAILED;
          notification.errorMessage = result.error.message;
          this.logger.error(
            `Email failed for reservation ${data.reservationId}: ${result.error.message}`,
          );
        } else {
          notification.status = NotificationStatus.SENT;
          this.logger.log(
            `Email sent for reservation ${data.reservationId} to ${to}`,
          );
        }
      } else {
        // Mock mode - log pero marcar como enviado
        notification.status = NotificationStatus.SENT;
        this.logger.log(
          `[MOCK EMAIL] to=${to} subject="${subject}" reservationId=${data.reservationId}`,
        );
        this.logger.debug(`[MOCK EMAIL HTML]\n${html}`);
      }
    } catch (err: unknown) {
      notification.status = NotificationStatus.FAILED;
      notification.errorMessage =
        err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Email exception for reservation ${data.reservationId}: ${notification.errorMessage}`,
      );
    }

    await this.notificationRepo.save(notification);
    return notification;
  }

  private async sendWithResend(
    payload: ResendEmailPayload,
  ): Promise<ResendResponse> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as ResendResponse;

      if (!response.ok) {
        return {
          error: {
            message: data.error?.message || `HTTP ${response.status}`,
          },
        };
      }

      return data;
    } catch (err: unknown) {
      return {
        error: {
          message: err instanceof Error ? err.message : 'Network error',
        },
      };
    }
  }

  private buildConfirmationEmailHtml(data: {
    clienteNombre: string;
    clubName: string;
    clubDireccion?: string | null;
    courtName: string;
    dateStr: string;
    startTime: string;
    endTime: string;
    precio: number;
    receiptUrl: string;
    reservationId: string;
  }): string {
    const precioFormatted = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
    }).format(data.precio);

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reserva Confirmada</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 480px; border-collapse: collapse;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
              <div style="font-size: 32px; margin-bottom: 8px;">✅</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Reserva Confirmada</h1>
              <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">Tu turno está asegurado</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="background-color: #ffffff; padding: 32px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
              
              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.5;">
                Hola <strong style="color: #1e293b;">${data.clienteNombre}</strong>,
              </p>
              
              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.5;">
                Tu reserva en <strong style="color: #1e293b;">${data.clubName}</strong> ha sido confirmada.
              </p>
              
              <!-- Reservation Details Card -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f8fafc; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Cancha</span>
                          <div style="color: #1e293b; font-size: 16px; font-weight: 600; margin-top: 4px;">${data.courtName}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Fecha</span>
                          <div style="color: #1e293b; font-size: 16px; font-weight: 600; margin-top: 4px;">${data.dateStr}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Horario</span>
                          <div style="color: #1e293b; font-size: 16px; font-weight: 600; margin-top: 4px;">${data.startTime} - ${data.endTime}</div>
                        </td>
                      </tr>
                      ${
                        data.clubDireccion
                          ? `
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
                          <span style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Dirección</span>
                          <div style="color: #1e293b; font-size: 16px; font-weight: 600; margin-top: 4px;">${data.clubDireccion}</div>
                        </td>
                      </tr>
                      `
                          : ''
                      }
                      <tr>
                        <td style="padding: 8px 0;">
                          <span style="color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Total</span>
                          <div style="color: #059669; font-size: 20px; font-weight: 700; margin-top: 4px;">${precioFormatted}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <a href="${data.receiptUrl}" style="display: inline-block; background-color: #1e293b; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 14px 28px; border-radius: 10px;">
                      Ver comprobante
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 24px 0 0; color: #94a3b8; font-size: 12px; text-align: center;">
                ID de reserva: ${data.reservationId}
              </p>
              
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px; text-align: center;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                Este email fue enviado por PadelPoint.<br>
                Si no realizaste esta reserva, podés ignorar este mensaje.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }
}
