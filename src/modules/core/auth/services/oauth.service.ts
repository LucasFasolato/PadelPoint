import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@core/users/entities/user.entity';
import { UsersService } from '@core/users/services/users.service';
import { UserRole } from '@core/users/enums/user-role.enum';
import { AuthIdentity } from '../entities/auth-identity.entity';
import { AuthProvider } from '../enums/auth-provider.enum';

export interface OAuthProfile {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  displayName: string | null;
}

@Injectable()
export class OAuthService {
  constructor(
    @InjectRepository(AuthIdentity)
    private readonly identityRepo: Repository<AuthIdentity>,
    private readonly users: UsersService,
  ) {}

  async linkOrCreateFromOAuth(profile: OAuthProfile): Promise<User> {
    // 1. Identity already linked → return the user
    const existing = await this.identityRepo.findOne({
      where: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    });
    if (existing) {
      const user = await this.users.findById(existing.userId);
      if (user) return user;
    }

    // 2. User exists by email → link a new identity to their account
    if (profile.email) {
      const userByEmail = await this.users.findByEmail(profile.email);
      if (userByEmail) {
        await this.saveIdentitySafe(userByEmail.id, profile);
        return userByEmail;
      }
    }

    // 3. No match → create user + identity
    const emailPrefix = profile.email?.split('@')[0] ?? profile.providerUserId;
    const newUser = await this.createUserSafe(profile, emailPrefix);
    await this.saveIdentitySafe(newUser.id, profile);
    return newUser;
  }

  // ──────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────

  private async createUserSafe(
    profile: OAuthProfile,
    emailPrefix: string,
  ): Promise<User> {
    try {
      return await this.users.create({
        email: profile.email ?? `${profile.providerUserId}@oauth.local`,
        passwordHash: null,
        role: UserRole.PLAYER,
        displayName: profile.displayName ?? emailPrefix,
        active: true,
        phone: null,
      });
    } catch (err) {
      // Race: another process already created this user
      if (this.isUniqueViolation(err)) {
        // Re-fetch via identity (another process may have completed the full flow)
        const identity = await this.identityRepo.findOne({
          where: {
            provider: profile.provider,
            providerUserId: profile.providerUserId,
          },
        });
        if (identity) {
          const user = await this.users.findById(identity.userId);
          if (user) return user;
        }
        // Fall back to email lookup
        if (profile.email) {
          const userByEmail = await this.users.findByEmail(profile.email);
          if (userByEmail) return userByEmail;
        }
      }
      throw err;
    }
  }

  private async saveIdentitySafe(
    userId: string,
    profile: OAuthProfile,
  ): Promise<void> {
    try {
      const identity = this.identityRepo.create({
        userId,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        passwordHash: null,
      });
      await this.identityRepo.save(identity);
    } catch (err) {
      // Race: unique constraint — identity was already inserted by another process
      if (this.isUniqueViolation(err)) return;
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    const e = err as Record<string, any>;
    return e?.code === '23505' || e?.driverError?.code === '23505';
  }
}
