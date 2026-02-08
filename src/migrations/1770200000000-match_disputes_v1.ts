import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchDisputesV11770200000000 implements MigrationInterface {
  name = 'MatchDisputesV11770200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Extend match_results status enum
    await queryRunner.query(
      `ALTER TYPE "public"."match_results_status_enum" ADD VALUE IF NOT EXISTS 'disputed'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."match_results_status_enum" ADD VALUE IF NOT EXISTS 'resolved'`,
    );

    // 2. Extend user_notifications type enum
    await queryRunner.query(
      `ALTER TYPE "user_notifications_type_enum" ADD VALUE IF NOT EXISTS 'match.disputed'`,
    );
    await queryRunner.query(
      `ALTER TYPE "user_notifications_type_enum" ADD VALUE IF NOT EXISTS 'match.resolved'`,
    );

    // 3. Create dispute enums
    await queryRunner.query(
      `CREATE TYPE "match_disputes_reasoncode_enum" AS ENUM('wrong_score', 'wrong_winner', 'match_not_played', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "match_disputes_status_enum" AS ENUM('open', 'resolved')`,
    );

    // 4. Create match_disputes table
    await queryRunner.query(
      `CREATE TABLE "match_disputes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "matchId" uuid NOT NULL,
        "raisedByUserId" uuid NOT NULL,
        "reasonCode" "match_disputes_reasoncode_enum" NOT NULL,
        "message" text,
        "status" "match_disputes_status_enum" NOT NULL DEFAULT 'open',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_match_disputes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_match_disputes_matchId" FOREIGN KEY ("matchId") REFERENCES "match_results"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_match_disputes_raisedByUserId" FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );

    // Unique partial index: only one OPEN dispute per match
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_match_disputes_matchId_open" ON "match_disputes" ("matchId") WHERE "status" = 'open'`,
    );

    // 5. Create audit log enum
    await queryRunner.query(
      `CREATE TYPE "match_audit_logs_action_enum" AS ENUM('dispute_raised', 'dispute_resolved')`,
    );

    // 6. Create match_audit_logs table
    await queryRunner.query(
      `CREATE TABLE "match_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "matchId" uuid NOT NULL,
        "actorUserId" uuid NOT NULL,
        "action" "match_audit_logs_action_enum" NOT NULL,
        "payload" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_match_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_match_audit_logs_matchId" FOREIGN KEY ("matchId") REFERENCES "match_results"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_match_audit_logs_actorUserId" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_match_audit_logs_matchId" ON "match_audit_logs" ("matchId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_match_audit_logs_matchId"`);
    await queryRunner.query(`DROP TABLE "match_audit_logs"`);
    await queryRunner.query(`DROP TYPE "match_audit_logs_action_enum"`);
    await queryRunner.query(`DROP INDEX "IDX_match_disputes_matchId_open"`);
    await queryRunner.query(`DROP TABLE "match_disputes"`);
    await queryRunner.query(`DROP TYPE "match_disputes_status_enum"`);
    await queryRunner.query(`DROP TYPE "match_disputes_reasoncode_enum"`);
    // Cannot remove enum values from match_results_status_enum / user_notifications_type_enum
  }
}
