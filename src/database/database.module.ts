import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        // Simplified: Only use the URL instead of separate host/port/user/pass
        url: config.get<string>('DATABASE_URL'),

        autoLoadEntities: true,

        // Recommended for migrations: false
        synchronize: config.get<boolean>('db.sync') === true,

        logging: config.get<boolean>('db.log') === true,

        // Critical for Railway Pro production database connections
        ssl:
          config.get<string>('NODE_ENV') === 'production'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
  ],
})
export class DatabaseModule {}
