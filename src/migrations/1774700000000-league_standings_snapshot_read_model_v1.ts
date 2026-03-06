import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueStandingsSnapshotReadModelV11774700000000
  implements MigrationInterface
{
  name = 'LeagueStandingsSnapshotReadModelV11774700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'league_standings_cache'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'league_standings_snapshot'
        ) THEN
          ALTER TABLE "league_standings_cache"
          RENAME TO "league_standings_snapshot";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'league_standings_snapshot'
            AND column_name = 'snapshotComputedAt'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'league_standings_snapshot'
            AND column_name = 'computedAt'
        ) THEN
          ALTER TABLE "league_standings_snapshot"
          RENAME COLUMN "snapshotComputedAt" TO "computedAt";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "league_standings_snapshot"
      ADD COLUMN IF NOT EXISTS "winRate" double precision NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "league_standings_snapshot"
      ADD COLUMN IF NOT EXISTS "lastMatchAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "league_standings_snapshot"
      ADD COLUMN IF NOT EXISTS "deltaPosition" integer
    `);

    await queryRunner.query(`
      UPDATE "league_standings_snapshot"
      SET "winRate" = CASE
        WHEN "played" > 0 THEN "wins"::double precision / "played"
        ELSE 0
      END,
      "lastMatchAt" = COALESCE("lastMatchAt", "lastWinAt"),
      "deltaPosition" = COALESCE("deltaPosition", "delta")
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."UQ_league_standings_cache_leagueId_userId"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_league_standings_cache_leagueId_position"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_league_standings_cache_leagueId_snapshotVersion"
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_league_standings_snapshot_leagueId_userId"
      ON "league_standings_snapshot" ("leagueId", "userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_league_standings_snapshot_leagueId_position"
      ON "league_standings_snapshot" ("leagueId", "position" ASC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_league_standings_snapshot_leagueId_snapshotVersion"
      ON "league_standings_snapshot" ("leagueId", "snapshotVersion" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_league_standings_snapshot_leagueId_computedAt"
      ON "league_standings_snapshot" ("leagueId", "computedAt" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_results_league_timeline"
      ON "match_results" (
        "leagueId",
        "scheduledAt" DESC,
        "playedAt" DESC,
        "createdAt" DESC,
        "id" DESC
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_results_pending_confirm_sort"
      ON "match_results" (
        "playedAt" DESC,
        "createdAt" DESC,
        "id" DESC
      )
      WHERE "status" = 'pending_confirm'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_results_pending_confirm_league_sort"
      ON "match_results" (
        "leagueId",
        "playedAt" DESC,
        "createdAt" DESC,
        "id" DESC
      )
      WHERE "status" = 'pending_confirm'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_notifications_ranking_snapshot_lookup"
      ON "user_notifications" (
        "type",
        ((data->>'leagueId')),
        ((data->>'computedAt'))
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_user_notifications_ranking_snapshot_lookup"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_match_results_pending_confirm_league_sort"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_match_results_pending_confirm_sort"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_match_results_league_timeline"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_league_standings_snapshot_leagueId_computedAt"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_league_standings_snapshot_leagueId_snapshotVersion"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_league_standings_snapshot_leagueId_position"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."UQ_league_standings_snapshot_leagueId_userId"
    `);

    await queryRunner.query(`
      ALTER TABLE "league_standings_snapshot"
      DROP COLUMN IF EXISTS "deltaPosition"
    `);
    await queryRunner.query(`
      ALTER TABLE "league_standings_snapshot"
      DROP COLUMN IF EXISTS "lastMatchAt"
    `);
    await queryRunner.query(`
      ALTER TABLE "league_standings_snapshot"
      DROP COLUMN IF EXISTS "winRate"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'league_standings_snapshot'
            AND column_name = 'computedAt'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'league_standings_snapshot'
            AND column_name = 'snapshotComputedAt'
        ) THEN
          ALTER TABLE "league_standings_snapshot"
          RENAME COLUMN "computedAt" TO "snapshotComputedAt";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_league_standings_cache_leagueId_userId"
      ON "league_standings_snapshot" ("leagueId", "userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_league_standings_cache_leagueId_position"
      ON "league_standings_snapshot" ("leagueId", "position" ASC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_league_standings_cache_leagueId_snapshotVersion"
      ON "league_standings_snapshot" ("leagueId", "snapshotVersion" DESC)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'league_standings_snapshot'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'league_standings_cache'
        ) THEN
          ALTER TABLE "league_standings_snapshot"
          RENAME TO "league_standings_cache";
        END IF;
      END $$;
    `);
  }
}
