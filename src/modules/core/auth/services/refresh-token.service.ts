import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { RefreshToken } from '../entities/refresh-token.entity';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createRefreshToken(userId: string): Promise<string> {
    const plaintext = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(plaintext);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const entity = this.repo.create({ userId, tokenHash, expiresAt, revokedAt: null });
    await this.repo.save(entity);

    return plaintext;
  }

  async validate(plaintext: string): Promise<RefreshToken | null> {
    const tokenHash = this.hash(plaintext);
    const token = await this.repo.findOne({ where: { tokenHash, revokedAt: IsNull() } });
    if (!token) return null;
    if (token.expiresAt < new Date()) return null;
    return token;
  }

  async rotate(plaintext: string): Promise<{ newPlaintext: string; userId: string }> {
    const token = await this.validate(plaintext);
    if (!token) throw new UnauthorizedException('Invalid or expired refresh token');

    token.revokedAt = new Date();
    await this.repo.save(token);

    const newPlaintext = await this.createRefreshToken(token.userId);
    return { newPlaintext, userId: token.userId };
  }

  async revoke(plaintext: string): Promise<void> {
    const tokenHash = this.hash(plaintext);
    await this.repo.update({ tokenHash, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repo.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }
}
