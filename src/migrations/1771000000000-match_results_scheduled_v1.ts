import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchResultsScheduledV11771000000000
  implements MigrationInterface
{
  name = 'MatchResultsScheduledV11771000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."match_results_status_enum" ADD VALUE IF NOT EXISTS 'scheduled'`,
    );

    await queryRunner.query(
      `ALTER TABLE "match_results" ADD COLUMN "scheduledAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "playedAt" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "teamASet1" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "teamBSet1" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "teamASet2" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "teamBSet2" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "winnerTeam" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "match_results" SET "playedAt" = NOW() WHERE "playedAt" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "match_results" SET "teamASet1" = 0 WHERE "teamASet1" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "match_results" SET "teamBSet1" = 0 WHERE "teamBSet1" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "match_results" SET "teamASet2" = 0 WHERE "teamASet2" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "match_results" SET "teamBSet2" = 0 WHERE "teamBSet2" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "match_results" SET "winnerTeam" = 'A' WHERE "winnerTeam" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "playedAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "teamASet1" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "teamBSet1" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "teamASet2" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "teamBSet2" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ALTER COLUMN "winnerTeam" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "match_results" DROP COLUMN "scheduledAt"`);
  }
}
