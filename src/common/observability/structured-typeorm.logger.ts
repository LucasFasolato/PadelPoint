import { Logger } from '@nestjs/common';
import type { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';
import { logStructured } from './structured-log.util';

export class StructuredTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new Logger('TypeOrm');
  private readonly enabled: boolean;

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  logQuery(
    query: string,
    parameters?: unknown[],
    queryRunner?: QueryRunner,
  ): void {
    void queryRunner;
    if (!this.enabled) {
      return;
    }

    logStructured(this.logger, 'debug', {
      event: 'db.query',
      query,
      parameters,
    });
  }

  logQueryError(
    error: string | Error,
    query: string,
    parameters?: unknown[],
    queryRunner?: QueryRunner,
  ): void {
    void queryRunner;
    logStructured(
      this.logger,
      'error',
      {
        event: 'db.query.error',
        query,
        parameters,
        reason: error instanceof Error ? error.message : error,
      },
      error instanceof Error ? error.stack : undefined,
    );
  }

  logQuerySlow(
    time: number,
    query: string,
    parameters?: unknown[],
    queryRunner?: QueryRunner,
  ): void {
    void queryRunner;
    logStructured(this.logger, 'warn', {
      event: 'db.query.slow',
      durationMs: time,
      query,
      parameters,
    });
  }

  logSchemaBuild(message: string, queryRunner?: QueryRunner): void {
    void queryRunner;
    if (!this.enabled) {
      return;
    }

    logStructured(this.logger, 'debug', {
      event: 'db.schema',
      message,
    });
  }

  logMigration(message: string, queryRunner?: QueryRunner): void {
    void queryRunner;
    logStructured(this.logger, 'log', {
      event: 'db.migration',
      message,
    });
  }

  log(
    level: 'log' | 'info' | 'warn',
    message: unknown,
    queryRunner?: QueryRunner,
  ): void {
    void queryRunner;
    const normalizedLevel = level === 'info' ? 'log' : level;
    logStructured(this.logger, normalizedLevel, {
      event: 'db.log',
      message,
    });
  }
}
