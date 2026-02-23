import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueShareToken1771500000000 implements MigrationInterface {
  name = 'LeagueShareToken1771500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leagues"
      ADD COLUMN IF NOT EXISTS "shareToken" character varying(128)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_leagues_share_token_unique"
      ON "leagues" ("shareToken")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_leagues_share_token_unique"
    `);
    await queryRunner.query(`
      ALTER TABLE "leagues"
      DROP COLUMN IF EXISTS "shareToken"
    `);
  }
}
