import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchResultsSourceAndChallengeInvitesSideV11773700000000
  implements MigrationInterface
{
  name = 'MatchResultsSourceAndChallengeInvitesSideV11773700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          INNER JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'match_results_source_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."match_results_source_enum" AS ENUM('reservation', 'manual');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "match_results"
      ADD COLUMN IF NOT EXISTS "source" "public"."match_results_source_enum"
    `);

    await queryRunner.query(`
      UPDATE "match_results"
      SET "source" = 'reservation'::"public"."match_results_source_enum"
      WHERE "source" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "match_results"
      ALTER COLUMN "source" SET DEFAULT 'reservation'::"public"."match_results_source_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "match_results"
      ALTER COLUMN "source" SET NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          INNER JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'challenge_invites_side_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."challenge_invites_side_enum" AS ENUM('A', 'B');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "challenge_invites"
      ADD COLUMN IF NOT EXISTS "side" "public"."challenge_invites_side_enum"
    `);

    await queryRunner.query(`
      UPDATE "challenge_invites"
      SET "side" = 'A'::"public"."challenge_invites_side_enum"
      WHERE "side" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "challenge_invites"
      ALTER COLUMN "side" SET DEFAULT 'A'::"public"."challenge_invites_side_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "challenge_invites"
      ALTER COLUMN "side" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "challenge_invites"
      DROP COLUMN IF EXISTS "side"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."challenge_invites_side_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "match_results"
      DROP COLUMN IF EXISTS "source"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."match_results_source_enum"
    `);
  }
}
