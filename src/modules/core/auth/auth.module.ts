import { DynamicModule, Logger, Module } from '@nestjs/common';
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
import { AppleStrategy } from './strategies/apple.strategy';
import { AuthAppleController } from './controllers/auth-apple.controller';
import { PasswordResetService } from './services/password-reset.service';
import { ResendEmailSender } from './email/resend-email-sender';
import { EMAIL_SENDER } from './email/email-sender';
import { PasswordResetRateLimiter } from './guards/password-reset-rate-limiter';
import { AuthPasswordController } from './controllers/auth-password.controller';
import { isAppleOAuthEnabled } from './utils/apple-oauth.util';

const logger = new Logger('AuthModule');

@Module({})
export class AuthModule {
  /**
   * Returns a DynamicModule so Apple OAuth providers/routes are only registered
   * when all APPLE_* env vars are present.
   *
   * ConfigModule.forRoot() (listed first in AppModule's imports) calls dotenv.config()
   * synchronously before this method runs, so process.env is fully populated
   * even for .env-based local-dev setups.  new ConfigService() reads directly
   * from process.env — no DI required at this point.
   */
  static register(): DynamicModule {
    const config = new ConfigService();
    const appleEnabled = isAppleOAuthEnabled(config);

    if (!appleEnabled) {
      logger.warn('Apple OAuth disabled (missing APPLE_* env vars)');
    }

    return {
      module: AuthModule,
      imports: [
        TypeOrmModule.forFeature([AuthIdentity, RefreshToken, PasswordResetToken]),
        UsersModule,
        PassportModule,
        ConfigModule,
        JwtModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (cfg: ConfigService) => {
            const secret = (cfg.get<string>('JWT_SECRET') ?? '').trim();
            if (!secret) throw new Error('JWT_SECRET is missing/empty');
            return { secret, signOptions: { expiresIn: '15m' } }; // keep literal for TS
          },
        }),
      ],
      controllers: [
        AuthController,
        AuthAdminBootstrapController,
        AuthGoogleController,
        ...(appleEnabled ? [AuthAppleController] : []),
        AuthPasswordController,
      ],
      providers: [
        AuthService,
        RefreshTokenService,
        OAuthService,
        JwtStrategy,
        GoogleStrategy,
        ...(appleEnabled ? [AppleStrategy] : []),
        PasswordResetService,
        PasswordResetRateLimiter,
        { provide: EMAIL_SENDER, useClass: ResendEmailSender },
      ],
    };
  }
}
