import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompetitiveEloHistoryCursorIndex1771400000000
  implements MigrationInterface
{
  name = 'CompetitiveEloHistoryCursorIndex1771400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_elo_history_profile_createdat_id"
      ON "elo_history" ("profileId", "createdAt" DESC, "id" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_elo_history_profile_createdat_id"
    `);
  }
}
