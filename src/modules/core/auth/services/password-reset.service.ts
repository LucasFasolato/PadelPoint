import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/services/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthIdentity } from '../entities/auth-identity.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { AuthProvider } from '../enums/auth-provider.enum';
import { EMAIL_SENDER } from '../email/email-sender';
import type { EmailSender } from '../email/email-sender';

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly appUrl: string;

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepo: Repository<PasswordResetToken>,
    @InjectRepository(AuthIdentity)
    private readonly identityRepo: Repository<AuthIdentity>,
    private readonly users: UsersService,
    private readonly refreshTokens: RefreshTokenService,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
    config: ConfigService,
  ) {
    this.appUrl = (config.get<string>('APP_URL') ?? '').replace(/\/$/, '');
  }

  async requestReset(email: string): Promise<{ ok: true }> {
    const normalized = email.toLowerCase().trim();
    const user = await this.users.findByEmail(normalized);

    if (!user) {
      // Never reveal whether the address exists
      return { ok: true };
    }

    // Invalidate all previous unused tokens for this user
    await this.resetTokenRepo.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    // Generate a cryptographically secure token
    const plaintext = randomBytes(32).toString('base64url');
    const tokenHash = this.sha256(plaintext);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    const tokenRow = this.resetTokenRepo.create({ userId: user.id, tokenHash, expiresAt, usedAt: null });
    await this.resetTokenRepo.save(tokenRow);

    const resetLink = `${this.appUrl}/reset-password?token=${plaintext}`;

    try {
      await this.emailSender.sendPasswordReset(normalized, resetLink);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`password reset email failed: email=${normalized} error=${msg}`);
      // Do not propagate — caller always gets { ok: true }
    }

    return { ok: true };
  }

  async confirmReset(token: string, newPassword: string): Promise<{ ok: true }> {
    const tokenHash = this.sha256(token);

    const tokenRow = await this.resetTokenRepo.findOne({
      where: { tokenHash },
      relations: ['user'],
    });

    if (!tokenRow) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    if (tokenRow.usedAt !== null) {
      throw new BadRequestException('Reset token already used');
    }
    if (tokenRow.expiresAt < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    const user = tokenRow.user;
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Upsert PASSWORD identity
    const existing = await this.identityRepo.findOne({
      where: { userId: user.id, provider: AuthProvider.PASSWORD },
    });

    if (existing) {
      existing.passwordHash = passwordHash;
      existing.email = user.email.toLowerCase();
      await this.identityRepo.save(existing);
    } else {
      const identity = this.identityRepo.create({
        userId: user.id,
        provider: AuthProvider.PASSWORD,
        email: user.email.toLowerCase(),
        passwordHash,
        providerUserId: null,
      });
      await this.identityRepo.save(identity);
    }

    // Mark token as consumed
    tokenRow.usedAt = new Date();
    await this.resetTokenRepo.save(tokenRow);

    // Invalidate all active sessions (refresh tokens)
    await this.refreshTokens.revokeAllForUser(user.id);

    return { ok: true };
  }

  private sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
