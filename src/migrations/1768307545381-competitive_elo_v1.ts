import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompetitiveEloV11768307545381 implements MigrationInterface {
  name = 'CompetitiveEloV11768307545381';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasMatchResults = await queryRunner.hasTable('match_results');
    const hasCompetitiveProfiles = await queryRunner.hasTable(
      'competitive_profiles',
    );
    const hasEloHistory = await queryRunner.hasTable('elo_history');
    const hasUsers = await queryRunner.hasTable('users');

    if (hasMatchResults) {
      await queryRunner.query(
        `ALTER TABLE "match_results" ADD COLUMN IF NOT EXISTS "eloApplied" boolean NOT NULL DEFAULT false`,
      );
    }

    if (hasCompetitiveProfiles) {
      await queryRunner.query(
        `ALTER TABLE "competitive_profiles" DROP CONSTRAINT IF EXISTS "FK_6a6e2e2804aaf5d2fa7d83f8fa5"`,
      );
      await queryRunner.query(
        `ALTER TABLE "competitive_profiles" ALTER COLUMN "userId" SET NOT NULL`,
      );
    }

    if (hasEloHistory) {
      await queryRunner.query(
        `ALTER TABLE "elo_history" DROP CONSTRAINT IF EXISTS "FK_9029f5325bc5061f6cb6e03568f"`,
      );
      await queryRunner.query(
        `ALTER TABLE "elo_history" ALTER COLUMN "profileId" SET NOT NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "elo_history" DROP COLUMN IF EXISTS "reason"`,
      );
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = 'elo_history_reason_enum'
              AND n.nspname = 'public'
          ) THEN
            CREATE TYPE "public"."elo_history_reason_enum" AS ENUM('init_category', 'match_result');
          END IF;
        END $$;`,
      );
      await queryRunner.query(
        `ALTER TABLE "elo_history" ADD COLUMN IF NOT EXISTS "reason" "public"."elo_history_reason_enum"`,
      );
      await queryRunner.query(
        `UPDATE "elo_history" SET "reason" = 'match_result' WHERE "reason" IS NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "elo_history" ALTER COLUMN "reason" SET NOT NULL`,
      );
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_0319cff089411aec8ba3e50486" ON "elo_history" ("reason", "refId")`,
      );
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_dc4360ccd457ec7370c99a9b45" ON "elo_history" ("profileId", "reason", "refId")`,
      );
    }

    if (hasCompetitiveProfiles && hasUsers) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_6a6e2e2804aaf5d2fa7d83f8fa5'
          ) THEN
            ALTER TABLE "competitive_profiles"
            ADD CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    if (hasEloHistory && hasCompetitiveProfiles) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_9029f5325bc5061f6cb6e03568f'
          ) THEN
            ALTER TABLE "elo_history"
            ADD CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f"
            FOREIGN KEY ("profileId") REFERENCES "competitive_profiles"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasMatchResults = await queryRunner.hasTable('match_results');
    const hasCompetitiveProfiles = await queryRunner.hasTable(
      'competitive_profiles',
    );
    const hasEloHistory = await queryRunner.hasTable('elo_history');
    const hasUsers = await queryRunner.hasTable('users');

    if (hasEloHistory) {
      await queryRunner.query(
        `ALTER TABLE "elo_history" DROP CONSTRAINT IF EXISTS "FK_9029f5325bc5061f6cb6e03568f"`,
      );
    }

    if (hasCompetitiveProfiles) {
      await queryRunner.query(
        `ALTER TABLE "competitive_profiles" DROP CONSTRAINT IF EXISTS "FK_6a6e2e2804aaf5d2fa7d83f8fa5"`,
      );
    }

    if (hasEloHistory) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."IDX_dc4360ccd457ec7370c99a9b45"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."IDX_0319cff089411aec8ba3e50486"`,
      );
      await queryRunner.query(
        `ALTER TABLE "elo_history" DROP COLUMN IF EXISTS "reason"`,
      );
      await queryRunner.query(
        `DROP TYPE IF EXISTS "public"."elo_history_reason_enum"`,
      );
      await queryRunner.query(
        `ALTER TABLE "elo_history" ADD COLUMN IF NOT EXISTS "reason" character varying(40)`,
      );
      await queryRunner.query(
        `UPDATE "elo_history" SET "reason" = 'match_result' WHERE "reason" IS NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "elo_history" ALTER COLUMN "reason" SET NOT NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "elo_history" ALTER COLUMN "profileId" DROP NOT NULL`,
      );
    }

    if (hasEloHistory && hasCompetitiveProfiles) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_9029f5325bc5061f6cb6e03568f'
          ) THEN
            ALTER TABLE "elo_history"
            ADD CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f"
            FOREIGN KEY ("profileId") REFERENCES "competitive_profiles"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    if (hasCompetitiveProfiles) {
      await queryRunner.query(
        `ALTER TABLE "competitive_profiles" ALTER COLUMN "userId" DROP NOT NULL`,
      );
    }

    if (hasCompetitiveProfiles && hasUsers) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_6a6e2e2804aaf5d2fa7d83f8fa5'
          ) THEN
            ALTER TABLE "competitive_profiles"
            ADD CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    if (hasMatchResults) {
      await queryRunner.query(
        `ALTER TABLE "match_results" DROP COLUMN IF EXISTS "eloApplied"`,
      );
    }
  }
}
