import { MigrationInterface, QueryRunner } from 'typeorm';

export class RankingsSnapshotSchedulerV11773300000000
  implements MigrationInterface
{
  name = 'RankingsSnapshotSchedulerV11773300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "global_ranking_snapshots" g
      USING (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY "dimensionKey", "categoryKey", timeframe, "modeKey", "asOfDate"
            ORDER BY version DESC, "computedAt" DESC, id DESC
          ) AS rn
        FROM "global_ranking_snapshots"
      ) ranked
      WHERE g.id = ranked.id
        AND ranked.rn > 1
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_global_ranking_snapshots_bucket"
      ON "global_ranking_snapshots" ("dimensionKey", "categoryKey", timeframe, "modeKey", "asOfDate")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ranking_snapshot_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trigger" character varying(24) NOT NULL,
        "status" character varying(24) NOT NULL,
        "scope" character varying(24),
        "provinceCode" character varying(16),
        "cityId" uuid,
        "categoryKey" character varying(24),
        "timeframe" character varying(24),
        "modeKey" character varying(24),
        "asOfDate" date,
        "candidates" integer NOT NULL DEFAULT 0,
        "computedRows" integer NOT NULL DEFAULT 0,
        "insertedSnapshots" integer NOT NULL DEFAULT 0,
        "movementEvents" integer NOT NULL DEFAULT 0,
        "durationMs" integer,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "error" text,
        "metadata" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ranking_snapshot_runs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ranking_snapshot_runs_createdAt"
      ON "ranking_snapshot_runs" ("createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ranking_snapshot_runs_status_createdAt"
      ON "ranking_snapshot_runs" ("status", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_ranking_snapshot_runs_status_createdAt"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_ranking_snapshot_runs_createdAt"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "ranking_snapshot_runs"`);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."UQ_global_ranking_snapshots_bucket"
    `);
  }
}
