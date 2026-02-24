import { Global, Module } from '@nestjs/common';
import {
  TypeOrmModule,
  getEntityManagerToken,
} from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

const OPENAPI_SNAPSHOT_MODE = process.env.OPENAPI_SNAPSHOT_MODE === '1';

function createOpenApiSnapshotDataSourceStub(): Partial<DataSource> {
  const manager = {};
  const stub: any = {
    entityMetadatas: [],
    manager: manager as any,
    options: { type: 'postgres' },
    getRepository: () => ({} as any),
    getTreeRepository: () => ({} as any),
    getMongoRepository: () => ({} as any),
    createEntityManager: () => manager as any,
    transaction: async (
      cb: (entityManager: unknown) => unknown | Promise<unknown>,
    ) => cb(manager),
  };
  return stub as Partial<DataSource>;
}

const databaseImports = OPENAPI_SNAPSHOT_MODE
  ? []
  : [
      TypeOrmModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const isProduction = configService.get('nodeEnv') === 'production';
          const dbUrl = configService.get<string>('databaseUrl') ?? '';

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
    ];

const databaseProviders = OPENAPI_SNAPSHOT_MODE
  ? [
      {
        provide: DataSource,
        useFactory: () => createOpenApiSnapshotDataSourceStub(),
      },
      {
        provide: getEntityManagerToken(),
        useFactory: () => ({}),
      },
    ]
  : [];

@Global()
@Module({
  imports: databaseImports,
  providers: databaseProviders,
  exports: databaseProviders,
})
export class DatabaseModule {}
