import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthAdminBootstrapController } from './controllers/auth-admin-bootstrap.controller';
import { AuthIdentity } from './entities/auth-identity.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshTokenService } from './services/refresh-token.service';
import { OAuthService } from './services/oauth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { AuthGoogleController } from './controllers/auth-google.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthIdentity, RefreshToken, PasswordResetToken]),
    UsersModule,
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = (config.get<string>('JWT_SECRET') ?? '').trim();
        if (!secret) throw new Error('JWT_SECRET is missing/empty');

        return {
          secret,
          signOptions: { expiresIn: '15m' }, // keep literal for TS
        };
      },
    }),
  ],
  controllers: [AuthController, AuthAdminBootstrapController, AuthGoogleController],
  providers: [AuthService, RefreshTokenService, OAuthService, JwtStrategy, GoogleStrategy],
})
export class AuthModule {}
