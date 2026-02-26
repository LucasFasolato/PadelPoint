import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchTypeV11772900000000 implements MigrationInterface {
  name = 'MatchTypeV11772900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."match_type_enum" AS ENUM('COMPETITIVE', 'FRIENDLY')`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" ADD "matchType" "public"."match_type_enum" NOT NULL DEFAULT 'COMPETITIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ADD "matchType" "public"."match_type_enum" NOT NULL DEFAULT 'COMPETITIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ADD "impactRanking" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `UPDATE "match_results" SET "impactRanking" = CASE WHEN "matchType" = 'FRIENDLY' THEN false ELSE true END`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "match_results" DROP COLUMN "impactRanking"`);
    await queryRunner.query(`ALTER TABLE "match_results" DROP COLUMN "matchType"`);
    await queryRunner.query(`ALTER TABLE "challenges" DROP COLUMN "matchType"`);
    await queryRunner.query(`DROP TYPE "public"."match_type_enum"`);
  }
}
