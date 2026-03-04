import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompetitiveAntiFarmingHardeningV11774300000000
  implements MigrationInterface
{
  name = 'CompetitiveAntiFarmingHardeningV11774300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "match_results"
      ADD COLUMN IF NOT EXISTS "eloProcessed" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      UPDATE "match_results"
      SET "eloProcessed" = true
      WHERE "eloProcessed" IS DISTINCT FROM true
        AND ("eloApplied" = true OR "rankingImpact" IS NOT NULL)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_results_anti_farm_window"
      ON "match_results" ("status", "matchType", "impactRanking", "playedAt", "challengeId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_challenges_anti_farm_roster"
      ON "challenges" ("teamA1Id", "teamA2Id", "teamB1Id", "teamB2Id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_challenges_anti_farm_roster"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_match_results_anti_farm_window"
    `);
    await queryRunner.query(`
      ALTER TABLE "match_results"
      DROP COLUMN IF EXISTS "eloProcessed"
    `);
  }
}
