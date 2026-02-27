import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentEventsBaseV11769019700000 implements MigrationInterface {
  name = 'PaymentEventsBaseV11769019700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "payment_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "paymentIntentId" uuid NOT NULL,
        "type" character varying(64) NOT NULL,
        "payload" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_events_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_events_intent_created" ON "payment_events" ("paymentIntentId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_payment_events_intent_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_events"`);
  }
}
