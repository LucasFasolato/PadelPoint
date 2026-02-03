import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationEventsAddResend1769010000000 implements MigrationInterface {
  name = 'NotificationEventsAddResend1769010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_events_type_enum" ADD VALUE IF NOT EXISTS 'notification.resend_requested'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."notification_events_type_enum_old" AS ENUM('hold.created', 'reservation.confirmed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_events" ALTER COLUMN "type" TYPE "public"."notification_events_type_enum_old" USING "type"::text::"public"."notification_events_type_enum_old"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."notification_events_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notification_events_type_enum_old" RENAME TO "notification_events_type_enum"`,
    );
  }
}
