import { MigrationInterface, QueryRunner } from 'typeorm';

export class GlobalRankingsSnapshotsV11773100000000
  implements MigrationInterface
{
  name = 'GlobalRankingsSnapshotsV11773100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_type WHERE typname = 'global_ranking_snapshots_scope_enum'
         ) THEN
           CREATE TYPE "public"."global_ranking_snapshots_scope_enum" AS ENUM('COUNTRY', 'PROVINCE', 'CITY');
         END IF;
       END$$`,
    );

    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_type WHERE typname = 'global_ranking_snapshots_timeframe_enum'
         ) THEN
           CREATE TYPE "public"."global_ranking_snapshots_timeframe_enum" AS ENUM('CURRENT_SEASON', 'LAST_90D');
         END IF;
       END$$`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "global_ranking_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "dimensionKey" character varying(160) NOT NULL,
        "scope" "public"."global_ranking_snapshots_scope_enum" NOT NULL,
        "provinceCode" character varying(16),
        "cityId" uuid,
        "categoryKey" character varying(24) NOT NULL,
        "timeframe" "public"."global_ranking_snapshots_timeframe_enum" NOT NULL DEFAULT 'CURRENT_SEASON',
        "modeKey" character varying(24) NOT NULL DEFAULT 'COMPETITIVE',
        "asOfDate" date NOT NULL,
        "version" integer NOT NULL,
        "computedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "rows" jsonb NOT NULL,
        CONSTRAINT "PK_global_ranking_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_global_ranking_snapshots_cityId" FOREIGN KEY ("cityId")
          REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_global_ranking_snapshots_dimension_lookup"
       ON "global_ranking_snapshots" ("dimensionKey", "categoryKey", "timeframe", "modeKey", "asOfDate")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_global_ranking_snapshots_scope_lookup"
       ON "global_ranking_snapshots" ("scope", "provinceCode", "cityId", "asOfDate")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_global_ranking_snapshots_computedAt"
       ON "global_ranking_snapshots" ("computedAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_global_ranking_snapshots_dimension_version"
       ON "global_ranking_snapshots" ("dimensionKey", "categoryKey", "timeframe", "modeKey", "version")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_match_results_rankings_query"
       ON "match_results" ("status", "playedAt", "matchType", "impactRanking")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_match_results_rankings_query"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_global_ranking_snapshots_dimension_version"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_global_ranking_snapshots_computedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_global_ranking_snapshots_scope_lookup"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_global_ranking_snapshots_dimension_lookup"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "global_ranking_snapshots"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."global_ranking_snapshots_timeframe_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."global_ranking_snapshots_scope_enum"`,
    );
  }
}

