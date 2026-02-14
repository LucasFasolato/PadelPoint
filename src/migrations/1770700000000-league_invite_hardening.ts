import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueInviteHardening1770700000000 implements MigrationInterface {
  name = 'LeagueInviteHardening1770700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add 'member_declined' to league_activity_type_enum
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
          ALTER TYPE "public"."league_activity_type_enum" ADD VALUE IF NOT EXISTS 'member_declined';
        END IF;
      END $$;`,
    );

    // 2. Normalize inviteId expression index naming
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_notifications_invite_id"`,
    );

    // 3. Expression index on user_notifications for invite-id lookups via jsonb
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_user_notifications_invite_id
       ON user_notifications ((data->>'inviteId'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_user_notifications_invite_id`,
    );
    // Enum values are intentionally not removed (Postgres limitation).
  }
}
