import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentIntentsStatusEnumBaseV11769019500000
  implements MigrationInterface
{
  name = 'PaymentIntentsStatusEnumBaseV11769019500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'payment_intents_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."payment_intents_status_enum" AS ENUM('PENDING', 'REQUIRES_ACTION', 'SUCCEEDED', 'CANCELLED', 'EXPIRED');
        END IF;
      END $$;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."payment_intents_status_enum"`,
    );
  }
}
