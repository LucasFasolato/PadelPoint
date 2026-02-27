import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchTypeV11772900000000 implements MigrationInterface {
  name = 'MatchTypeV11772900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'match_type_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."match_type_enum" AS ENUM('COMPETITIVE', 'FRIENDLY');
        END IF;
      END $$;`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "matchType" "public"."match_type_enum" NOT NULL DEFAULT 'COMPETITIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ADD COLUMN IF NOT EXISTS "matchType" "public"."match_type_enum" NOT NULL DEFAULT 'COMPETITIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" ADD COLUMN IF NOT EXISTS "impactRanking" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `UPDATE "match_results" SET "impactRanking" = CASE WHEN "matchType" = 'FRIENDLY' THEN false ELSE true END`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "match_results" DROP COLUMN IF EXISTS "impactRanking"`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" DROP COLUMN IF EXISTS "matchType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP COLUMN IF EXISTS "matchType"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."match_type_enum"`);
  }
}
