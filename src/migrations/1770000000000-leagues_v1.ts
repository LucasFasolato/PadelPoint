import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeaguesV11770000000000 implements MigrationInterface {
  name = 'LeaguesV11770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum types
    await queryRunner.query(
      `CREATE TYPE "leagues_status_enum" AS ENUM('draft', 'active', 'finished')`,
    );

    await queryRunner.query(
      `CREATE TYPE "league_invites_status_enum" AS ENUM('pending', 'accepted', 'declined', 'expired')`,
    );

    // Leagues table
    await queryRunner.query(
      `CREATE TABLE "leagues" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(120) NOT NULL,
        "creatorId" uuid NOT NULL,
        "startDate" date NOT NULL,
        "endDate" date NOT NULL,
        "status" "leagues_status_enum" NOT NULL DEFAULT 'draft',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leagues" PRIMARY KEY ("id"),
        CONSTRAINT "FK_leagues_creatorId" FOREIGN KEY ("creatorId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_leagues_creatorId" ON "leagues" ("creatorId")`,
    );

    // League members table
    await queryRunner.query(
      `CREATE TABLE "league_members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leagueId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "points" integer NOT NULL DEFAULT 0,
        "wins" integer NOT NULL DEFAULT 0,
        "losses" integer NOT NULL DEFAULT 0,
        "draws" integer NOT NULL DEFAULT 0,
        "position" integer,
        "joinedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_league_members" PRIMARY KEY ("id"),
        CONSTRAINT "FK_league_members_leagueId" FOREIGN KEY ("leagueId")
          REFERENCES "leagues"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_league_members_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_league_members_leagueId_userId" ON "league_members" ("leagueId", "userId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_league_members_leagueId" ON "league_members" ("leagueId")`,
    );

    // League invites table
    await queryRunner.query(
      `CREATE TABLE "league_invites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leagueId" uuid NOT NULL,
        "invitedUserId" uuid,
        "invitedEmail" character varying(120),
        "token" character varying(64) NOT NULL,
        "status" "league_invites_status_enum" NOT NULL DEFAULT 'pending',
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_league_invites" PRIMARY KEY ("id"),
        CONSTRAINT "FK_league_invites_leagueId" FOREIGN KEY ("leagueId")
          REFERENCES "leagues"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_league_invites_token" ON "league_invites" ("token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_league_invites_token"`);

    await queryRunner.query(`DROP TABLE "league_invites"`);

    await queryRunner.query(`DROP INDEX "IDX_league_members_leagueId"`);

    await queryRunner.query(`DROP INDEX "IDX_league_members_leagueId_userId"`);

    await queryRunner.query(`DROP TABLE "league_members"`);

    await queryRunner.query(`DROP INDEX "IDX_leagues_creatorId"`);

    await queryRunner.query(`DROP TABLE "leagues"`);

    await queryRunner.query(`DROP TYPE "league_invites_status_enum"`);

    await queryRunner.query(`DROP TYPE "leagues_status_enum"`);
  }
}
