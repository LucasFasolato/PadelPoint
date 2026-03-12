import { MigrationInterface, QueryRunner } from 'typeorm';

export class PerformanceHardeningV11775100000000 implements MigrationInterface {
  name = 'PerformanceHardeningV11775100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_notifications_user_created_id"
      ON "user_notifications" ("userId", "createdAt", "id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_notifications_unread_feed"
      ON "user_notifications" ("userId", "createdAt" DESC, "id" DESC)
      WHERE "readAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_notifications_ranking_snapshot_lookup"
      ON "user_notifications"
      (((data->>'leagueId')), ((data->>'computedAt')))
      WHERE "type" = 'league.ranking_moved'
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.courts') IS NOT NULL THEN
          CREATE INDEX IF NOT EXISTS "idx_courts_club_active"
          ON "courts" ("clubId", "activa");
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.court_availability_rules') IS NOT NULL THEN
          CREATE INDEX IF NOT EXISTS "idx_court_availability_rules_lookup"
          ON "court_availability_rules"
          ("courtId", "activo", "diaSemana", "horaInicio", "horaFin");
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.reservations') IS NOT NULL THEN
          CREATE INDEX IF NOT EXISTS "idx_reservations_court_status_created"
          ON "reservations"
          ("courtId", "status", "startAt", "endAt", "createdAt");
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.reservations') IS NOT NULL THEN
          CREATE INDEX IF NOT EXISTS "idx_reservations_court_active_overlap"
          ON "reservations" ("courtId", "startAt", "endAt", "createdAt" DESC)
          WHERE "status" IN ('hold', 'confirmed', 'payment_pending');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_match_messages_v2_match_created_id"
      ON "match_messages_v2" ("match_id", "created_at", "id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_match_proposals_v2_match_created_id"
      ON "match_proposals_v2" ("match_id", "created_at", "id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_league_standings_read_model_rank_order"
      ON "league_standings_snapshot" ("leagueId", "position", "userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_matches_v2_team_a_player_1_feed"
      ON "matches_v2" (
        "team_a_player_1_id",
        (COALESCE("played_at", "scheduled_at", "created_at")) DESC,
        "id" DESC
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_matches_v2_team_a_player_2_feed"
      ON "matches_v2" (
        "team_a_player_2_id",
        (COALESCE("played_at", "scheduled_at", "created_at")) DESC,
        "id" DESC
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_matches_v2_team_b_player_1_feed"
      ON "matches_v2" (
        "team_b_player_1_id",
        (COALESCE("played_at", "scheduled_at", "created_at")) DESC,
        "id" DESC
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_matches_v2_team_b_player_2_feed"
      ON "matches_v2" (
        "team_b_player_2_id",
        (COALESCE("played_at", "scheduled_at", "created_at")) DESC,
        "id" DESC
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_matches_v2_team_b_player_2_feed"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_matches_v2_team_b_player_1_feed"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_matches_v2_team_a_player_2_feed"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_matches_v2_team_a_player_1_feed"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_league_standings_read_model_rank_order"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_match_proposals_v2_match_created_id"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_match_messages_v2_match_created_id"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_reservations_court_active_overlap"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_reservations_court_status_created"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_court_availability_rules_lookup"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_courts_club_active"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_user_notifications_ranking_snapshot_lookup"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_user_notifications_unread_feed"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_user_notifications_user_created_id"
    `);
  }
}
