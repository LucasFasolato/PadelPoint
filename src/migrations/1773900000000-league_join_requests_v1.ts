import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueJoinRequestsV11773900000000 implements MigrationInterface {
  name = 'LeagueJoinRequestsV11773900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          INNER JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'league_join_requests_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."league_join_requests_status_enum"
          AS ENUM ('pending', 'approved', 'rejected', 'canceled');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "league_join_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leagueId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "status" "public"."league_join_requests_status_enum" NOT NULL DEFAULT 'pending',
        "message" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_league_join_requests" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      ADD COLUMN IF NOT EXISTS "leagueId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      ADD COLUMN IF NOT EXISTS "userId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      ADD COLUMN IF NOT EXISTS "status" "public"."league_join_requests_status_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      ADD COLUMN IF NOT EXISTS "message" text
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      UPDATE "league_join_requests"
      SET "status" = 'pending'::"public"."league_join_requests_status_enum"
      WHERE "status" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."league_join_requests_status_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      ALTER COLUMN "status" SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_league_join_requests_league_user"
      ON "league_join_requests" ("leagueId", "userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_league_join_requests_league_status"
      ON "league_join_requests" ("leagueId", "status")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_league_join_requests_leagueId'
        ) THEN
          ALTER TABLE "league_join_requests"
          ADD CONSTRAINT "FK_league_join_requests_leagueId"
          FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_league_join_requests_userId'
        ) THEN
          ALTER TABLE "league_join_requests"
          ADD CONSTRAINT "FK_league_join_requests_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      DROP CONSTRAINT IF EXISTS "FK_league_join_requests_userId"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_join_requests"
      DROP CONSTRAINT IF EXISTS "FK_league_join_requests_leagueId"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_league_join_requests_league_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_league_join_requests_league_user"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "league_join_requests"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."league_join_requests_status_enum"
    `);
  }
}
