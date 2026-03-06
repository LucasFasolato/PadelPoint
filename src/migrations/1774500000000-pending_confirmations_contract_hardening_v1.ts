import { MigrationInterface, QueryRunner } from 'typeorm';

export class PendingConfirmationsContractHardeningV11774500000000 implements MigrationInterface {
  name = 'PendingConfirmationsContractHardeningV11774500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "league_activity_type_enum"
      ADD VALUE IF NOT EXISTS 'match_rejected'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_results_pending_confirm_league_createdAt"
      ON "match_results" ("leagueId", "createdAt" DESC)
      WHERE "status" = 'pending_confirm'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_match_results_pending_confirm_league_createdAt"
    `);
    await queryRunner.query(`SELECT 1`);
  }
}
