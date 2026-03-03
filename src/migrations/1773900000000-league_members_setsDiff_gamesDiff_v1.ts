import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueMembersSetsDiffGamesDiffV11773900000000 implements MigrationInterface {
  name = 'LeagueMembersSetsDiffGamesDiffV11773900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // If snake_case columns exist but camelCase do not, rename them.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'league_members' AND column_name = 'sets_diff'
        ) AND NOT EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'league_members' AND column_name = 'setsDiff'
        ) THEN
          ALTER TABLE "league_members" RENAME COLUMN "sets_diff" TO "setsDiff";
        END IF;

        IF EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'league_members' AND column_name = 'games_diff'
        ) AND NOT EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'league_members' AND column_name = 'gamesDiff'
        ) THEN
          ALTER TABLE "league_members" RENAME COLUMN "games_diff" TO "gamesDiff";
        END IF;
      END $$;
    `);

    // Add columns if they don't already exist
    await queryRunner.query(`
      ALTER TABLE "league_members" ADD COLUMN IF NOT EXISTS "setsDiff" integer;
    `);
    await queryRunner.query(`
      ALTER TABLE "league_members" ADD COLUMN IF NOT EXISTS "gamesDiff" integer;
    `);

    // Backfill existing rows
    await queryRunner.query(`
      UPDATE "league_members" 
      SET "setsDiff" = COALESCE("setsDiff", 0) 
      WHERE "setsDiff" IS NULL;
    `);
    await queryRunner.query(`
      UPDATE "league_members" 
      SET "gamesDiff" = COALESCE("gamesDiff", 0) 
      WHERE "gamesDiff" IS NULL;
    `);

    // Ensure defaults and not-null constraints (idempotent)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'league_members' AND column_name = 'setsDiff'
            AND column_default IS NULL
        ) THEN
          ALTER TABLE "league_members" ALTER COLUMN "setsDiff" SET DEFAULT 0;
        END IF;
        IF EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'league_members' AND column_name = 'setsDiff'
            AND is_nullable = 'YES'
        ) THEN
          ALTER TABLE "league_members" ALTER COLUMN "setsDiff" SET NOT NULL;
        END IF;

        IF EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'league_members' AND column_name = 'gamesDiff'
            AND column_default IS NULL
        ) THEN
          ALTER TABLE "league_members" ALTER COLUMN "gamesDiff" SET DEFAULT 0;
        END IF;
        IF EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'league_members' AND column_name = 'gamesDiff'
            AND is_nullable = 'YES'
        ) THEN
          ALTER TABLE "league_members" ALTER COLUMN "gamesDiff" SET NOT NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "league_members" DROP COLUMN IF EXISTS "setsDiff";
    `);
    await queryRunner.query(`
      ALTER TABLE "league_members" DROP COLUMN IF EXISTS "gamesDiff";
    `);
    // we intentionally do not rename back snake_case columns
  }
}
