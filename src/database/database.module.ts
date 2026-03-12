import { Global, Module } from '@nestjs/common';
import { TypeOrmModule, getEntityManagerToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  DataSource,
  type DataSourceOptions,
  type EntityManager,
  type EntityTarget,
  type MongoRepository,
  type ObjectLiteral,
  type Repository,
  type TreeRepository,
} from 'typeorm';
import { StructuredTypeOrmLogger } from '@common/observability/structured-typeorm.logger';
import { DEFAULT_SLOW_QUERY_MS } from '@common/security/security.constants';

const OPENAPI_SNAPSHOT_MODE = process.env.OPENAPI_SNAPSHOT_MODE === '1';

function createOpenApiSnapshotDataSourceStub(): Partial<DataSource> {
  const manager = {} as EntityManager;
  const transaction = (<T>(
    isolationLevelOrRunInTransaction:
      | string
      | ((entityManager: EntityManager) => Promise<T>),
    maybeRunInTransaction?: (entityManager: EntityManager) => Promise<T>,
  ): Promise<T> => {
    const runInTransaction =
      typeof isolationLevelOrRunInTransaction === 'function'
        ? isolationLevelOrRunInTransaction
        : maybeRunInTransaction;

    if (!runInTransaction) {
      return Promise.reject(new Error('Transaction callback is required'));
    }

    return runInTransaction(manager);
  }) as DataSource['transaction'];
  const stub = {
    entityMetadatas: [],
    manager,
    options: { type: 'postgres' } as DataSourceOptions,
    getRepository: <Entity extends ObjectLiteral>(
      target: EntityTarget<Entity>,
    ): Repository<Entity> => {
      void target;
      return {} as Repository<Entity>;
    },
    getTreeRepository: <Entity extends ObjectLiteral>(
      target: EntityTarget<Entity>,
    ): TreeRepository<Entity> => {
      void target;
      return {} as TreeRepository<Entity>;
    },
    getMongoRepository: <Entity extends ObjectLiteral>(
      target: EntityTarget<Entity>,
    ): MongoRepository<Entity> => {
      void target;
      return {} as MongoRepository<Entity>;
    },
    createEntityManager: (): EntityManager => manager,
    transaction,
  };
  return stub;
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
          const dbLogging = configService.get<boolean>('db.log') ?? false;

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
            logging: dbLogging
              ? ['query', 'error', 'warn', 'migration', 'schema']
              : ['error', 'warn', 'migration'],
            logger: new StructuredTypeOrmLogger(dbLogging),
            maxQueryExecutionTime:
              configService.get<number>('observability.slowQueryMs') ??
              DEFAULT_SLOW_QUERY_MS,
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
