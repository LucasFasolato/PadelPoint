import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchesV2BaseV11774900000000 implements MigrationInterface {
  name = 'MatchesV2BaseV11774900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "matches_v2" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "origin_type" character varying NOT NULL,
        "origin_challenge_intent_id" uuid,
        "origin_league_challenge_id" uuid,
        "source" character varying NOT NULL,
        "league_id" uuid,
        "competition_mode" character varying NOT NULL,
        "match_type" character varying NOT NULL,
        "team_a_player_1_id" uuid NOT NULL,
        "team_a_player_2_id" uuid NOT NULL,
        "team_b_player_1_id" uuid NOT NULL,
        "team_b_player_2_id" uuid NOT NULL,
        "status" character varying NOT NULL,
        "coordination_status" character varying NOT NULL DEFAULT 'NONE',
        "scheduled_at" TIMESTAMP WITH TIME ZONE,
        "played_at" TIMESTAMP WITH TIME ZONE,
        "location_label" character varying,
        "club_id" uuid,
        "court_id" uuid,
        "result_reported_at" TIMESTAMP WITH TIME ZONE,
        "result_reported_by_user_id" uuid,
        "winner_team" character varying,
        "sets_json" jsonb,
        "confirmed_at" TIMESTAMP WITH TIME ZONE,
        "confirmed_by_user_id" uuid,
        "rejected_at" TIMESTAMP WITH TIME ZONE,
        "rejected_by_user_id" uuid,
        "rejection_reason_code" character varying,
        "rejection_message" text,
        "disputed_at" TIMESTAMP WITH TIME ZONE,
        "has_open_dispute" boolean NOT NULL DEFAULT false,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason_code" character varying,
        "impact_ranking" boolean NOT NULL DEFAULT false,
        "elo_applied" boolean NOT NULL DEFAULT false,
        "standings_applied" boolean NOT NULL DEFAULT false,
        "ranking_impact_json" jsonb,
        "admin_override_type" character varying,
        "admin_override_by_user_id" uuid,
        "admin_override_at" TIMESTAMP WITH TIME ZONE,
        "admin_override_reason" text,
        "legacy_challenge_id" uuid,
        "legacy_match_result_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_matches_v2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_matches_v2_origin_league_challenge_id" FOREIGN KEY ("origin_league_challenge_id") REFERENCES "league_challenges"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_league_id" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_team_a_player_1_id" FOREIGN KEY ("team_a_player_1_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_team_a_player_2_id" FOREIGN KEY ("team_a_player_2_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_team_b_player_1_id" FOREIGN KEY ("team_b_player_1_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_team_b_player_2_id" FOREIGN KEY ("team_b_player_2_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_club_id" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_court_id" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_result_reported_by_user_id" FOREIGN KEY ("result_reported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_confirmed_by_user_id" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_rejected_by_user_id" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_voided_by_user_id" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_admin_override_by_user_id" FOREIGN KEY ("admin_override_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_legacy_challenge_id" FOREIGN KEY ("legacy_challenge_id") REFERENCES "challenges"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_matches_v2_legacy_match_result_id" FOREIGN KEY ("legacy_match_result_id") REFERENCES "match_results"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_league_id" ON "matches_v2" ("league_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_status" ON "matches_v2" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_team_a_player_1_id" ON "matches_v2" ("team_a_player_1_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_team_a_player_2_id" ON "matches_v2" ("team_a_player_2_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_team_b_player_1_id" ON "matches_v2" ("team_b_player_1_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_team_b_player_2_id" ON "matches_v2" ("team_b_player_2_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_scheduled_at" ON "matches_v2" ("scheduled_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_played_at" ON "matches_v2" ("played_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_created_at" ON "matches_v2" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_matches_v2_legacy_challenge_id" ON "matches_v2" ("legacy_challenge_id") WHERE "legacy_challenge_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_matches_v2_legacy_match_result_id" ON "matches_v2" ("legacy_match_result_id") WHERE "legacy_match_result_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_matches_v2_league_status_played_at" ON "matches_v2" ("league_id", "status", "played_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "match_proposals_v2" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "match_id" uuid NOT NULL,
        "proposed_by_user_id" uuid NOT NULL,
        "scheduled_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "location_label" character varying,
        "club_id" uuid,
        "court_id" uuid,
        "note" text,
        "status" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_match_proposals_v2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_match_proposals_v2_match_id" FOREIGN KEY ("match_id") REFERENCES "matches_v2"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_match_proposals_v2_proposed_by_user_id" FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_match_proposals_v2_club_id" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_match_proposals_v2_court_id" FOREIGN KEY ("court_id") REFERENCES "courts"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_proposals_v2_match_id" ON "match_proposals_v2" ("match_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_proposals_v2_match_id_status" ON "match_proposals_v2" ("match_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_proposals_v2_created_at" ON "match_proposals_v2" ("created_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "match_messages_v2" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "match_id" uuid NOT NULL,
        "sender_user_id" uuid NOT NULL,
        "message" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_match_messages_v2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_match_messages_v2_match_id" FOREIGN KEY ("match_id") REFERENCES "matches_v2"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_match_messages_v2_sender_user_id" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_messages_v2_match_id" ON "match_messages_v2" ("match_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_messages_v2_created_at" ON "match_messages_v2" ("created_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "match_disputes_v2" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "match_id" uuid NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "reason_code" character varying NOT NULL,
        "message" text,
        "status" character varying NOT NULL,
        "resolution" character varying,
        "resolution_message" text,
        "resolved_by_user_id" uuid,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_match_disputes_v2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_match_disputes_v2_match_id" FOREIGN KEY ("match_id") REFERENCES "matches_v2"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_match_disputes_v2_created_by_user_id" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "FK_match_disputes_v2_resolved_by_user_id" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_match_disputes_v2_match_id" ON "match_disputes_v2" ("match_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_disputes_v2_status" ON "match_disputes_v2" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "match_audit_events_v2" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "match_id" uuid NOT NULL,
        "event_type" character varying NOT NULL,
        "actor_user_id" uuid,
        "payload_json" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_match_audit_events_v2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_match_audit_events_v2_match_id" FOREIGN KEY ("match_id") REFERENCES "matches_v2"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_match_audit_events_v2_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_audit_events_v2_match_id" ON "match_audit_events_v2" ("match_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_audit_events_v2_event_type" ON "match_audit_events_v2" ("event_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_match_audit_events_v2_created_at" ON "match_audit_events_v2" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_audit_events_v2_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_audit_events_v2_event_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_audit_events_v2_match_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "match_audit_events_v2"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_disputes_v2_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_disputes_v2_match_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "match_disputes_v2"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_messages_v2_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_messages_v2_match_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "match_messages_v2"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_proposals_v2_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_proposals_v2_match_id_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_match_proposals_v2_match_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "match_proposals_v2"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_league_status_played_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_legacy_match_result_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_legacy_challenge_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_played_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_scheduled_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_team_b_player_2_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_team_b_player_1_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_team_a_player_2_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_team_a_player_1_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_matches_v2_league_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "matches_v2"`);
  }
}
