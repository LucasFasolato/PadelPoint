import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthAdminBootstrapController } from './controllers/auth-admin-bootstrap.controller';

@Module({
  imports: [
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
          signOptions: { expiresIn: '7d' }, // keep literal for TS
        };
      },
    }),
  ],
  controllers: [AuthController, AuthAdminBootstrapController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
