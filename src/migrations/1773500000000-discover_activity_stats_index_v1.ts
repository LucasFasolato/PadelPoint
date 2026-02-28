import { MigrationInterface, QueryRunner } from 'typeorm';

export class DiscoverActivityStatsIndexV11773500000000
  implements MigrationInterface
{
  name = 'DiscoverActivityStatsIndexV11773500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_results_discover_activity"
      ON "match_results" ("status", "matchType", "playedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_match_results_discover_activity"
    `);
  }
}

