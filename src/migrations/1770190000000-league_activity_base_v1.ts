import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueActivityBaseV11770190000000 implements MigrationInterface {
  name = 'LeagueActivityBaseV11770190000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'league_activity_type_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."league_activity_type_enum" AS ENUM(
            'match_reported',
            'match_confirmed',
            'match_disputed',
            'match_resolved',
            'member_joined',
            'settings_updated'
          );
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "league_activity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leagueId" uuid NOT NULL,
        "type" "public"."league_activity_type_enum" NOT NULL,
        "actorId" uuid,
        "entityId" uuid,
        "payload" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_league_activity_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_league_activity_leagueId" ON "league_activity" ("leagueId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_league_activity_createdAt" ON "league_activity" ("createdAt")`,
    );

    const hasLeagues = await queryRunner.hasTable('leagues');
    if (hasLeagues) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_league_activity_leagueId'
          ) THEN
            ALTER TABLE "league_activity"
            ADD CONSTRAINT "FK_league_activity_leagueId"
            FOREIGN KEY ("leagueId") REFERENCES "leagues"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "league_activity" DROP CONSTRAINT IF EXISTS "FK_league_activity_leagueId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_league_activity_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_league_activity_leagueId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "league_activity"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."league_activity_type_enum"`,
    );
  }
}
