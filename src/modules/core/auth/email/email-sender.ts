export const EMAIL_SENDER = 'EmailSender';

export interface EmailSender {
  sendPasswordReset(to: string, resetLink: string): Promise<void>;
}
