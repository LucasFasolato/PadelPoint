import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompetitiveRankingIndex1771300000000
  implements MigrationInterface
{
  name = 'CompetitiveRankingIndex1771300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_competitive_profiles_ranking_cursor"
      ON "competitive_profiles" ("elo" DESC, "matchesPlayed" DESC, "userId" ASC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_competitive_profiles_ranking_cursor"
    `);
  }
}
