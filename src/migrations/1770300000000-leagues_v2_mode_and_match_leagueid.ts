import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeaguesV2ModeAndMatchLeagueid1770300000000
  implements MigrationInterface
{
  name = 'LeaguesV2ModeAndMatchLeagueid1770300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create league mode enum
    await queryRunner.query(
      `CREATE TYPE "leagues_mode_enum" AS ENUM('open', 'scheduled')`,
    );

    // 2. Add mode column to leagues (default SCHEDULED to preserve existing behavior)
    await queryRunner.query(
      `ALTER TABLE "leagues" ADD "mode" "leagues_mode_enum" NOT NULL DEFAULT 'scheduled'`,
    );

    // 3. Make startDate and endDate nullable
    await queryRunner.query(
      `ALTER TABLE "leagues" ALTER COLUMN "startDate" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "leagues" ALTER COLUMN "endDate" DROP NOT NULL`,
    );

    // 4. Add leagueId column to match_results
    await queryRunner.query(
      `ALTER TABLE "match_results" ADD "leagueId" uuid`,
    );

    // 5. Add FK constraint for leagueId
    await queryRunner.query(
      `ALTER TABLE "match_results" ADD CONSTRAINT "FK_match_results_leagueId" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE SET NULL`,
    );

    // 6. Index on leagueId for efficient league match queries
    await queryRunner.query(
      `CREATE INDEX "IDX_match_results_leagueId" ON "match_results" ("leagueId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_match_results_leagueId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" DROP CONSTRAINT "FK_match_results_leagueId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" DROP COLUMN "leagueId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "leagues" ALTER COLUMN "endDate" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "leagues" ALTER COLUMN "startDate" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "leagues" DROP COLUMN "mode"`,
    );
    await queryRunner.query(
      `DROP TYPE "leagues_mode_enum"`,
    );
  }
}
