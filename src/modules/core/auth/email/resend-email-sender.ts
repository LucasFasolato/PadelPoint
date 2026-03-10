import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailSender } from './email-sender';

type ResendPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
};
type ResendResponse = { id?: string; error?: { message?: string } };

@Injectable()
export class ResendEmailSender implements EmailSender {
  private readonly logger = new Logger(ResendEmailSender.name);
  private readonly apiKey: string | null;
  private readonly from: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('RESEND_API_KEY') ?? null;
    this.from =
      config.get<string>('RESEND_FROM_EMAIL') ??
      config.get<string>('EMAIL_FROM') ??
      'PadelPoint <noreply@padelpoint.app>';
    this.isProduction =
      (config.get<string>('NODE_ENV') ?? 'development') === 'production';

    if (!this.apiKey) {
      if (this.isProduction) {
        this.logger.error(
          'RESEND_API_KEY is not set — password reset emails will fail in production',
        );
      } else {
        this.logger.warn(
          'RESEND_API_KEY not set — reset links will be logged only (dev mode)',
        );
      }
    }
  }

  async sendPasswordReset(to: string, resetLink: string): Promise<void> {
    if (!this.apiKey) {
      if (this.isProduction) {
        throw new Error(
          'RESEND_API_KEY is not configured — cannot send password reset email',
        );
      }
      // Dev / staging: log the link so developers can use it without a real email service
      this.logger.log(`[DEV] Password reset link for ${to} → ${resetLink}`);
      return;
    }

    const subject = 'Recuperar contraseña — PadelPoint';
    const html = this.buildHtml(resetLink);

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to,
        subject,
        html,
      } satisfies ResendPayload),
    });

    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as ResendResponse;
      const msg = body.error?.message ?? `HTTP ${resp.status}`;
      this.logger.error(`password reset email failed: to=${to} error=${msg}`);
      throw new Error(`Failed to send password reset email: ${msg}`);
    }

    this.logger.log(`password reset email sent: to=${to}`);
  }

  private buildHtml(resetLink: string): string {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recuperar contraseña</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 480px; border-collapse: collapse;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
              <div style="font-size: 32px; margin-bottom: 8px;">&#128272;</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Recuperar contrasena</h1>
              <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">PadelPoint</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color: #ffffff; padding: 32px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
              <p style="margin: 0 0 16px; color: #475569; font-size: 16px; line-height: 1.5;">
                Recibimos una solicitud para restablecer la contrasena de tu cuenta.
              </p>
              <p style="margin: 0 0 24px; color: #475569; font-size: 16px; line-height: 1.5;">
                Hace clic en el boton de abajo para elegir una nueva contrasena.
                El enlace es valido por <strong>30 minutos</strong>.
              </p>

              <!-- CTA -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${resetLink}"
                       style="display: inline-block; background-color: #1e293b; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 14px 28px; border-radius: 10px;">
                      Restablecer contrasena
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px; color: #94a3b8; font-size: 13px;">
                Si no podes hacer clic en el boton, copia y pega este enlace en tu navegador:
              </p>
              <p style="margin: 0 0 24px; word-break: break-all; color: #64748b; font-size: 13px;">
                ${resetLink}
              </p>
              <p style="margin: 0; color: #94a3b8; font-size: 13px;">
                Si no solicitaste restablecer tu contrasena, podes ignorar este mensaje.
                Tu cuenta no sera modificada.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px; text-align: center;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                Este email fue enviado por PadelPoint.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
  }
}
