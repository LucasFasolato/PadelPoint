import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { UsersService } from '../../users/services/users.service';

type JwtPayload = { sub: string; email: string; role: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    const secret = (config.get<string>('JWT_SECRET') ?? '').trim();
    if (!secret) throw new Error('JWT_SECRET is missing/empty');

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies as Record<string, string>)?.['pp_at'] ?? null,
      ]),
      secretOrKey: secret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedException();
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      cityId: user.cityId ?? null,
    };
  }
}
