import { MigrationInterface, QueryRunner } from "typeorm";

export class PaymentsWebhookEventLog1769020000000 implements MigrationInterface {
    name = 'PaymentsWebhookEventLog1769020000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."reservations_status_enum" ADD VALUE IF NOT EXISTS 'payment_pending'`);
        await queryRunner.query(`ALTER TYPE "public"."reservations_status_enum" ADD VALUE IF NOT EXISTS 'expired'`);

        await queryRunner.query(`ALTER TYPE "public"."payment_intents_status_enum" ADD VALUE IF NOT EXISTS 'APPROVED'`);
        await queryRunner.query(`ALTER TYPE "public"."payment_intents_status_enum" ADD VALUE IF NOT EXISTS 'FAILED'`);

        await queryRunner.query(`ALTER TABLE "payment_events" ADD "providerEventId" character varying(128)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_payment_events_provider_event_id" ON "payment_events" ("providerEventId")`);

        await queryRunner.query(`CREATE TABLE "event_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(64) NOT NULL, "payload" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_event_logs_id" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "event_logs"`);

        await queryRunner.query(`DROP INDEX "public"."IDX_payment_events_provider_event_id"`);
        await queryRunner.query(`ALTER TABLE "payment_events" DROP COLUMN "providerEventId"`);

        await queryRunner.query(`CREATE TYPE "public"."payment_intents_status_enum_old" AS ENUM('PENDING', 'REQUIRES_ACTION', 'SUCCEEDED', 'CANCELLED', 'EXPIRED')`);
        await queryRunner.query(`ALTER TABLE "payment_intents" ALTER COLUMN "status" TYPE "public"."payment_intents_status_enum_old" USING "status"::text::"public"."payment_intents_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."payment_intents_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."payment_intents_status_enum_old" RENAME TO "payment_intents_status_enum"`);

        await queryRunner.query(`CREATE TYPE "public"."reservations_status_enum_old" AS ENUM('hold', 'confirmed', 'cancelled')`);
        await queryRunner.query(`ALTER TABLE "reservations" ALTER COLUMN "status" TYPE "public"."reservations_status_enum_old" USING "status"::text::"public"."reservations_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."reservations_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."reservations_status_enum_old" RENAME TO "reservations_status_enum"`);
    }

}
