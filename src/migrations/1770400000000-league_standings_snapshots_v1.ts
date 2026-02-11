import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueStandingsSnapshotsV11770400000000
  implements MigrationInterface
{
  name = 'LeagueStandingsSnapshotsV11770400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "league_standings_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leagueId" uuid NOT NULL,
        "version" integer NOT NULL,
        "computedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "rows" jsonb NOT NULL,
        CONSTRAINT "PK_league_standings_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_league_standings_snapshots_leagueId" FOREIGN KEY ("leagueId")
          REFERENCES "leagues"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_league_standings_snapshots_leagueId" ON "league_standings_snapshots" ("leagueId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_league_standings_snapshots_computedAt" ON "league_standings_snapshots" ("computedAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_league_standings_snapshots_leagueId_version" ON "league_standings_snapshots" ("leagueId", "version")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "UQ_league_standings_snapshots_leagueId_version"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_league_standings_snapshots_computedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_league_standings_snapshots_leagueId"`,
    );
    await queryRunner.query(`DROP TABLE "league_standings_snapshots"`);
  }
}
