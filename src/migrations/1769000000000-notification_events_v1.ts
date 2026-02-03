import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationEventsV11769000000000 implements MigrationInterface {
  name = 'NotificationEventsV11769000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."notification_events_type_enum" AS ENUM('hold.created', 'reservation.confirmed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_events_channel_enum" AS ENUM('email', 'whatsapp', 'mock')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" "public"."notification_events_type_enum" NOT NULL, "reservationId" uuid NOT NULL, "userId" uuid, "channel" "public"."notification_events_channel_enum" NOT NULL, "payload" jsonb NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_70fb1004ac77045d0d0ea3c9b06" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77c3a8db71de92f072d9d6c76b" ON "notification_events" ("type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d97d51c5699e62a8f33c9ae2c" ON "notification_events" ("reservationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b4d2c3f8e18e4b1f5a4f6a94f" ON "notification_events" ("createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b4d2c3f8e18e4b1f5a4f6a94f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d97d51c5699e62a8f33c9ae2c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77c3a8db71de92f072d9d6c76b"`,
    );
    await queryRunner.query(`DROP TABLE "notification_events"`);
    await queryRunner.query(
      `DROP TYPE "public"."notification_events_channel_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."notification_events_type_enum"`,
    );
  }
}
