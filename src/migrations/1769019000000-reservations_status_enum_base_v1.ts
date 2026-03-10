import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReservationsStatusEnumBaseV11769019000000 implements MigrationInterface {
  name = 'ReservationsStatusEnumBaseV11769019000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'reservations_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."reservations_status_enum" AS ENUM('hold', 'payment_pending', 'confirmed', 'cancelled', 'expired');
        END IF;
      END $$;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."reservations_status_enum"`,
    );
  }
}
