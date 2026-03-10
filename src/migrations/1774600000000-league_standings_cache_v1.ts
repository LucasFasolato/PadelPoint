import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueStandingsCacheV11774600000000 implements MigrationInterface {
  name = 'LeagueStandingsCacheV11774600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "league_standings_cache" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leagueId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "position" integer NOT NULL,
        "played" integer NOT NULL DEFAULT 0,
        "wins" integer NOT NULL DEFAULT 0,
        "losses" integer NOT NULL DEFAULT 0,
        "draws" integer NOT NULL DEFAULT 0,
        "points" integer NOT NULL DEFAULT 0,
        "setsDiff" integer NOT NULL DEFAULT 0,
        "gamesDiff" integer NOT NULL DEFAULT 0,
        "lastWinAt" TIMESTAMPTZ,
        "delta" integer,
        "oldPosition" integer,
        "movementType" character varying(16),
        "snapshotVersion" integer NOT NULL,
        "snapshotComputedAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_league_standings_cache" PRIMARY KEY ("id"),
        CONSTRAINT "FK_league_standings_cache_leagueId" FOREIGN KEY ("leagueId")
          REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_league_standings_cache_leagueId_userId"
      ON "league_standings_cache" ("leagueId", "userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_league_standings_cache_leagueId_position"
      ON "league_standings_cache" ("leagueId", "position" ASC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_league_standings_cache_leagueId_snapshotVersion"
      ON "league_standings_cache" ("leagueId", "snapshotVersion" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_results_league_standings_lookup"
      ON "match_results" ("leagueId", "status", "impactRanking", "playedAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_match_results_league_standings_lookup"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_league_standings_cache_leagueId_snapshotVersion"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_league_standings_cache_leagueId_position"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."UQ_league_standings_cache_leagueId_userId"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "league_standings_cache"
    `);
  }
}
