import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchResultsRankingImpactV11774200000000 implements MigrationInterface {
  name = 'MatchResultsRankingImpactV11774200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "match_results"
      ADD COLUMN IF NOT EXISTS "rankingImpact" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "match_results"
      DROP COLUMN IF EXISTS "rankingImpact"
    `);
  }
}
