import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueChallengesV11770600000000 implements MigrationInterface {
  name = 'LeagueChallengesV11770600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "league_challenges_status_enum" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'COMPLETED')`,
    );

    await queryRunner.query(
      `CREATE TABLE "league_challenges" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leagueId" uuid NOT NULL,
        "createdById" uuid NOT NULL,
        "opponentId" uuid NOT NULL,
        "status" "league_challenges_status_enum" NOT NULL DEFAULT 'PENDING',
        "message" text,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now() + interval '7 days',
        "acceptedAt" TIMESTAMP WITH TIME ZONE,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "matchId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_league_challenges" PRIMARY KEY ("id"),
        CONSTRAINT "FK_league_challenges_leagueId" FOREIGN KEY ("leagueId")
          REFERENCES "leagues"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_league_challenges_createdById" FOREIGN KEY ("createdById")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_league_challenges_opponentId" FOREIGN KEY ("opponentId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_league_challenges_matchId" FOREIGN KEY ("matchId")
          REFERENCES "match_results"("id") ON DELETE SET NULL
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_league_challenges_leagueId" ON "league_challenges" ("leagueId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_league_challenges_createdById" ON "league_challenges" ("createdById")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_league_challenges_opponentId" ON "league_challenges" ("opponentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_league_challenges_status" ON "league_challenges" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_league_challenges_expiresAt" ON "league_challenges" ("expiresAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_league_challenges_matchId" ON "league_challenges" ("matchId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_league_challenges_active_pair" ON "league_challenges" (
        "leagueId",
        LEAST("createdById", "opponentId"),
        GREATEST("createdById", "opponentId")
      )
      WHERE "status" IN ('PENDING', 'ACCEPTED')`,
    );

    await queryRunner.query(
      `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'league_activity_type_enum'
            AND n.nspname = 'public'
        ) THEN
          ALTER TYPE "public"."league_activity_type_enum" ADD VALUE IF NOT EXISTS 'challenge_created';
          ALTER TYPE "public"."league_activity_type_enum" ADD VALUE IF NOT EXISTS 'challenge_accepted';
          ALTER TYPE "public"."league_activity_type_enum" ADD VALUE IF NOT EXISTS 'challenge_declined';
          ALTER TYPE "public"."league_activity_type_enum" ADD VALUE IF NOT EXISTS 'challenge_expired';
        END IF;
      END $$;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_league_challenges_active_pair"`);
    await queryRunner.query(`DROP INDEX "IDX_league_challenges_matchId"`);
    await queryRunner.query(`DROP INDEX "IDX_league_challenges_expiresAt"`);
    await queryRunner.query(`DROP INDEX "IDX_league_challenges_status"`);
    await queryRunner.query(`DROP INDEX "IDX_league_challenges_opponentId"`);
    await queryRunner.query(`DROP INDEX "IDX_league_challenges_createdById"`);
    await queryRunner.query(`DROP INDEX "IDX_league_challenges_leagueId"`);
    await queryRunner.query(`DROP TABLE "league_challenges"`);
    await queryRunner.query(`DROP TYPE "league_challenges_status_enum"`);
    // Enum values added to league_activity_type_enum are intentionally not removed.
  }
}
