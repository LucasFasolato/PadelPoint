import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../../users/services/users.service';
import { UserRole } from '../../users/enums/user-role.enum';
import { AuthIdentity } from '../entities/auth-identity.entity';
import { AuthProvider } from '../enums/auth-provider.enum';
import { RefreshTokenService } from './refresh-token.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { userId: string; email: string; role: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    @InjectRepository(AuthIdentity)
    private readonly identityRepo: Repository<AuthIdentity>,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<AuthTokens> {
    const email = input.email.toLowerCase().trim();

    const exists = await this.users.findByEmail(email);
    if (exists) throw new BadRequestException('Email already in use');

    const user = await this.users.create({
      email,
      passwordHash: null,
      role: UserRole.PLAYER,
      displayName: input.displayName?.trim() ?? null,
      active: true,
    });

    const passwordHash = await bcrypt.hash(input.password, 10);
    const identity = this.identityRepo.create({
      userId: user.id,
      provider: AuthProvider.PASSWORD,
      email,
      passwordHash,
    });
    await this.identityRepo.save(identity);

    return this.issueTokens(user.id, user.email, user.role);
  }

  async login(input: { email: string; password: string }): Promise<AuthTokens> {
    const user = await this.validateCredentials(input);
    return this.issueTokens(user.id, user.email, user.role);
  }

  async loginPlayer(input: {
    email: string;
    password: string;
  }): Promise<AuthTokens> {
    const user = await this.validateCredentials(input);
    if (user.role !== UserRole.PLAYER) {
      throw new ForbiddenException('Only player accounts allowed');
    }
    return this.issueTokens(user.id, user.email, user.role);
  }

  /**
   * Signs a new access token only — no refresh token row created.
   * Used by the /auth/refresh endpoint after token rotation.
   */
  issueAccessToken(
    userId: string,
    email: string,
    role: string,
  ): {
    accessToken: string;
    user: { userId: string; email: string; role: string };
  } {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not loaded');
    const accessToken = this.jwt.sign({ sub: userId, email, role });
    return { accessToken, user: { userId, email, role } };
  }

  /**
   * Signs a new access token AND creates a refresh token row.
   * Used on login/register.
   */
  async issueTokens(
    userId: string,
    email: string,
    role: string,
  ): Promise<AuthTokens> {
    const { accessToken, user } = this.issueAccessToken(userId, email, role);
    const refreshToken = await this.refreshTokens.createRefreshToken(userId);
    return { accessToken, refreshToken, user };
  }

  private async validateCredentials(input: {
    email: string;
    password: string;
  }) {
    const email = input.email.toLowerCase().trim();

    const user = await this.users.findByEmail(email);
    if (!user || !user.active)
      throw new UnauthorizedException('Invalid credentials');

    const identity = await this.identityRepo.findOne({
      where: { userId: user.id, provider: AuthProvider.PASSWORD },
    });

    if (!identity || !identity.passwordHash) {
      const allIdentities = await this.identityRepo.find({
        where: { userId: user.id },
      });
      const providers = allIdentities
        .filter((i) => i.provider !== AuthProvider.PASSWORD)
        .map((i) => i.provider);
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_PROVIDER_REQUIRED',
        message: 'Use Google/Apple or set a password',
        providers,
      });
    }

    const ok = await bcrypt.compare(input.password, identity.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return user;
  }
}
