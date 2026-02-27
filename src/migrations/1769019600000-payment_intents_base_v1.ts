import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentIntentsBaseV11769019600000 implements MigrationInterface {
  name = 'PaymentIntentsBaseV11769019600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'payment_reference_type_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."payment_reference_type_enum" AS ENUM('RESERVATION', 'LEAGUE', 'CHALLENGE');
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "payment_intents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'ARS',
        "status" "public"."payment_intents_status_enum" NOT NULL DEFAULT 'PENDING',
        "referenceType" "public"."payment_reference_type_enum" NOT NULL,
        "referenceId" uuid NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "paidAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_intents_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_intents_referenceType_referenceId" ON "payment_intents" ("referenceType", "referenceId")`,
    );

    const hasUsers = await queryRunner.hasTable('users');
    if (hasUsers) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_payment_intents_userId'
          ) THEN
            ALTER TABLE "payment_intents"
            ADD CONSTRAINT "FK_payment_intents_userId"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_intents" DROP CONSTRAINT IF EXISTS "FK_payment_intents_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_payment_intents_referenceType_referenceId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_intents"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."payment_reference_type_enum"`,
    );
  }
}
