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
        host: config.get<string>('db.host'),
        port: config.get<number>('db.port'),
        username: config.get<string>('db.user'),
        password: config.get<string>('db.password'),
        database: config.get<string>('db.name'),

        autoLoadEntities: true,

        // ✅ recomendado para migraciones: false
        // Si querés permitirlo en dev con DB_SYNC=true, dejalo así:
        synchronize: config.get<boolean>('db.sync') === false,

        logging: config.get<boolean>('db.log') === true,
      }),
    }),
  ],
})
export class DatabaseModule {}
