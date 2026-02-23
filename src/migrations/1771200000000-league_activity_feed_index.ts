import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a composite index on league_activity(leagueId, createdAt DESC)
 * used by the activity feed API (GET /leagues/:id/activity).
 * The separate single-column indexes that existed before are kept.
 */
export class LeagueActivityFeedIndex1771200000000 implements MigrationInterface {
  name = 'LeagueActivityFeedIndex1771200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_league_activity_league_createdat"
      ON "league_activity" ("leagueId", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_league_activity_league_createdat"
    `);
  }
}
