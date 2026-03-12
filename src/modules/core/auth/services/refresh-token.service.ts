import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
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

  async createRefreshToken(
    userId: string,
    tokenFamilyId: string = randomUUID(),
  ): Promise<string> {
    const plaintext = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(plaintext);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const entity = this.repo.create({
      userId,
      tokenHash,
      tokenFamilyId,
      expiresAt,
      revoked: false,
      revokedAt: null,
    });
    await this.repo.save(entity);

    return plaintext;
  }

  async validate(plaintext: string): Promise<RefreshToken | null> {
    const token = await this.findByPlaintext(plaintext);
    if (!token) return null;
    if (token.revoked || token.revokedAt !== null) return null;
    if (token.expiresAt < new Date()) return null;
    return token;
  }

  async rotate(
    plaintext: string,
  ): Promise<{ newPlaintext: string; userId: string }> {
    const token = await this.findByPlaintext(plaintext);
    if (!token || token.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (token.revoked || token.revokedAt !== null) {
      await this.revokeFamily(token.userId, token.tokenFamilyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    token.revoked = true;
    token.revokedAt = new Date();
    await this.repo.save(token);

    const newPlaintext = await this.createRefreshToken(
      token.userId,
      token.tokenFamilyId,
    );
    return { newPlaintext, userId: token.userId };
  }

  async revoke(plaintext: string): Promise<void> {
    const token = await this.findByPlaintext(plaintext);
    if (!token || token.revoked || token.revokedAt !== null) {
      return;
    }

    token.revoked = true;
    token.revokedAt = new Date();
    await this.repo.save(token);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const revokedAt = new Date();
    await this.repo.update({ userId }, { revoked: true, revokedAt });
  }

  private async revokeFamily(
    userId: string,
    tokenFamilyId: string,
  ): Promise<void> {
    const revokedAt = new Date();
    await this.repo.update(
      { userId, tokenFamilyId },
      { revoked: true, revokedAt },
    );
  }

  private async findByPlaintext(
    plaintext: string,
  ): Promise<RefreshToken | null> {
    const tokenHash = this.hash(plaintext);
    return this.repo.findOne({ where: { tokenHash } });
  }
}
