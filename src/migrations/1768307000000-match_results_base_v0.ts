import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchResultsBaseV01768307000000 implements MigrationInterface {
  name = 'MatchResultsBaseV01768307000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    const hasMatchResults = await queryRunner.hasTable('match_results');
    if (hasMatchResults) return;

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'match_results_winnerteam_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."match_results_winnerteam_enum" AS ENUM('A', 'B');
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'match_results_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."match_results_status_enum" AS ENUM('pending_confirm', 'confirmed', 'rejected');
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "match_results" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "challengeId" uuid NOT NULL,
        "playedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "teamASet1" integer NOT NULL,
        "teamBSet1" integer NOT NULL,
        "teamASet2" integer NOT NULL,
        "teamBSet2" integer NOT NULL,
        "teamASet3" integer,
        "teamBSet3" integer,
        "winnerTeam" "public"."match_results_winnerteam_enum" NOT NULL,
        "status" "public"."match_results_status_enum" NOT NULL DEFAULT 'pending_confirm',
        "reportedByUserId" uuid NOT NULL,
        "confirmedByUserId" uuid,
        "rejectionReason" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "REL_d96b39b955cbb0730f1c4161de" UNIQUE ("challengeId"),
        CONSTRAINT "PK_788799fb3b8324d976620b485f2" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_d96b39b955cbb0730f1c4161de" ON "match_results" ("challengeId")`,
    );

    const hasChallenges = await queryRunner.hasTable('challenges');
    if (hasChallenges) {
      await queryRunner.query(
        `ALTER TABLE "match_results" ADD CONSTRAINT "FK_d96b39b955cbb0730f1c4161de7" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }

    const hasUsers = await queryRunner.hasTable('users');
    if (hasUsers) {
      await queryRunner.query(
        `ALTER TABLE "match_results" ADD CONSTRAINT "FK_49744d33ae1be851d1150bbefe8" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
      await queryRunner.query(
        `ALTER TABLE "match_results" ADD CONSTRAINT "FK_cd75a6f8d950ba4710960848f1c" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasMatchResults = await queryRunner.hasTable('match_results');
    if (!hasMatchResults) return;

    await queryRunner.query(
      `ALTER TABLE "match_results" DROP CONSTRAINT IF EXISTS "FK_cd75a6f8d950ba4710960848f1c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" DROP CONSTRAINT IF EXISTS "FK_49744d33ae1be851d1150bbefe8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_results" DROP CONSTRAINT IF EXISTS "FK_d96b39b955cbb0730f1c4161de7"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_d96b39b955cbb0730f1c4161de"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "match_results"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."match_results_status_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."match_results_winnerteam_enum"`,
    );
  }
}
