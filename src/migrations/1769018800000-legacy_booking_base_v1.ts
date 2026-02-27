import { MigrationInterface, QueryRunner } from 'typeorm';

export class LegacyBookingBaseV11769018800000 implements MigrationInterface {
  name = 'LegacyBookingBaseV11769018800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "clubs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "nombre" character varying(120) NOT NULL,
        "direccion" character varying(200) NOT NULL,
        "telefono" character varying(30) NOT NULL,
        "email" character varying(160) NOT NULL,
        "latitud" numeric(10,7),
        "longitud" numeric(10,7),
        "activo" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_clubs_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_clubs_email" ON "clubs" ("email")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "courts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "nombre" character varying(120) NOT NULL,
        "superficie" character varying(60) NOT NULL,
        "precioPorHora" numeric(10,2) NOT NULL,
        "activa" boolean NOT NULL DEFAULT true,
        "clubId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_courts_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_courts_clubId" ON "courts" ("clubId")`,
    );
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_courts_clubId'
        ) THEN
          ALTER TABLE "courts"
          ADD CONSTRAINT "FK_courts_clubId"
          FOREIGN KEY ("clubId") REFERENCES "clubs"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;`,
    );

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
          CREATE TYPE "public"."reservations_status_enum" AS ENUM('hold', 'confirmed', 'cancelled');
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "reservations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "courtId" uuid NOT NULL,
        "startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "endAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" "public"."reservations_status_enum" NOT NULL DEFAULT 'hold',
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "checkoutToken" character varying(64),
        "checkoutTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "receiptToken" character varying(64),
        "receiptTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "confirmedAt" TIMESTAMP WITH TIME ZONE,
        "cancelledAt" TIMESTAMP WITH TIME ZONE,
        "clienteNombre" character varying(120) NOT NULL,
        "clienteEmail" character varying(120),
        "clienteTelefono" character varying(40),
        "precio" numeric(10,2) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reservations_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_reservations_checkoutToken" ON "reservations" ("checkoutToken") WHERE "checkoutToken" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_reservations_receiptToken" ON "reservations" ("receiptToken") WHERE "receiptToken" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_reservations_court_start_end_status" ON "reservations" ("courtId", "startAt", "endAt", "status")`,
    );

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_reservations_courtId'
        ) THEN
          ALTER TABLE "reservations"
          ADD CONSTRAINT "FK_reservations_courtId"
          FOREIGN KEY ("courtId") REFERENCES "courts"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT IF EXISTS "FK_reservations_courtId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_reservations_court_start_end_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_reservations_receiptToken"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_reservations_checkoutToken"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "reservations"`);
    await queryRunner.query(
      `ALTER TABLE "courts" DROP CONSTRAINT IF EXISTS "FK_courts_clubId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_courts_clubId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "courts"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_clubs_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "clubs"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."reservations_status_enum"`,
    );
  }
}
