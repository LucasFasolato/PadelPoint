import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserNotificationsLeagueTypes1770100000000 implements MigrationInterface {
  name = 'UserNotificationsLeagueTypes1770100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "user_notifications_type_enum" ADD VALUE IF NOT EXISTS 'league.invite_received'`,
    );
    await queryRunner.query(
      `ALTER TYPE "user_notifications_type_enum" ADD VALUE IF NOT EXISTS 'league.invite_accepted'`,
    );
    await queryRunner.query(
      `ALTER TYPE "user_notifications_type_enum" ADD VALUE IF NOT EXISTS 'league.invite_declined'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type.
    // The values are harmless if unused, so this is intentionally a no-op.
    await queryRunner.query(`SELECT 1`);
  }
}
