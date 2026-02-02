import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction = configService.get('nodeEnv') === 'production';
        const dbUrl = configService.get<string>('databaseUrl');

        // Detectar si necesitamos SSL (Railway lo requiere, Localhost usualmente no)
        const sslEnabled =
          isProduction ||
          dbUrl.includes('rlwy.net') ||
          dbUrl.includes('railway');

        return {
          type: 'postgres',
          url: dbUrl,
          autoLoadEntities: true,
          synchronize: configService.get<boolean>('db.sync'),
          logging: configService.get<boolean>('db.log'),
          ssl: sslEnabled ? { rejectUnauthorized: false } : false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
