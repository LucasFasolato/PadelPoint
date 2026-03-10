import { MigrationInterface, QueryRunner } from 'typeorm';

export class GeoUpsertSeedArV11773000000000 implements MigrationInterface {
  name = 'GeoUpsertSeedArV11773000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "provinces" ADD COLUMN IF NOT EXISTS "code" character varying(16)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_provinces_code" ON "provinces" ("code") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_provinces_countryId_code" ON "provinces" ("countryId", "code") WHERE "code" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "normalizedName" character varying(160) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `UPDATE "cities" SET "normalizedName" = regexp_replace(lower(trim("name")), '\\s+', ' ', 'g')`,
    );
    await queryRunner.query(
      `ALTER TABLE "cities" ALTER COLUMN "normalizedName" DROP DEFAULT`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cities_provinceId_normalizedName" ON "cities" ("provinceId", "normalizedName") `,
    );

    await queryRunner.query(
      `INSERT INTO "countries" ("id", "name", "createdAt", "updatedAt")
       SELECT uuid_generate_v4(), 'Argentina', now(), now()
       WHERE NOT EXISTS (
         SELECT 1 FROM "countries" WHERE lower(trim("name")) = 'argentina'
       )`,
    );

    await queryRunner.query(
      `WITH ar AS (
         SELECT id FROM "countries"
         WHERE lower(trim("name")) = 'argentina'
         ORDER BY "createdAt" ASC
         LIMIT 1
       )
       UPDATE "provinces" p
       SET "code" = mapping.code
       FROM (
         VALUES
           ('BUENOS AIRES', 'B'),
           ('CIUDAD AUTONOMA DE BUENOS AIRES', 'C'),
           ('CATAMARCA', 'K'),
           ('CHACO', 'H'),
           ('CHUBUT', 'U'),
           ('CORDOBA', 'X'),
           ('CORRIENTES', 'W'),
           ('ENTRE RIOS', 'E'),
           ('FORMOSA', 'P'),
           ('JUJUY', 'Y'),
           ('LA PAMPA', 'L'),
           ('LA RIOJA', 'F'),
           ('MENDOZA', 'M'),
           ('MISIONES', 'N'),
           ('NEUQUEN', 'Q'),
           ('RIO NEGRO', 'R'),
           ('SALTA', 'A'),
           ('SAN JUAN', 'J'),
           ('SAN LUIS', 'D'),
           ('SANTA CRUZ', 'Z'),
           ('SANTA FE', 'S'),
           ('SANTIAGO DEL ESTERO', 'G'),
           ('TIERRA DEL FUEGO', 'V'),
           ('TUCUMAN', 'T')
       ) AS mapping(name, code),
       ar
       WHERE p."countryId" = ar.id
         AND upper(trim(p."name")) = mapping.name
         AND p."code" IS NULL`,
    );

    await queryRunner.query(
      `WITH ar AS (
         SELECT id FROM "countries"
         WHERE lower(trim("name")) = 'argentina'
         ORDER BY "createdAt" ASC
         LIMIT 1
       ),
       provinces_seed AS (
         SELECT *
         FROM (
           VALUES
             ('Buenos Aires', 'B'),
             ('Ciudad Autonoma de Buenos Aires', 'C'),
             ('Catamarca', 'K'),
             ('Chaco', 'H'),
             ('Chubut', 'U'),
             ('Cordoba', 'X'),
             ('Corrientes', 'W'),
             ('Entre Rios', 'E'),
             ('Formosa', 'P'),
             ('Jujuy', 'Y'),
             ('La Pampa', 'L'),
             ('La Rioja', 'F'),
             ('Mendoza', 'M'),
             ('Misiones', 'N'),
             ('Neuquen', 'Q'),
             ('Rio Negro', 'R'),
             ('Salta', 'A'),
             ('San Juan', 'J'),
             ('San Luis', 'D'),
             ('Santa Cruz', 'Z'),
             ('Santa Fe', 'S'),
             ('Santiago del Estero', 'G'),
             ('Tierra del Fuego', 'V'),
             ('Tucuman', 'T')
         ) AS v(name, code)
       )
       INSERT INTO "provinces" ("id", "name", "code", "countryId", "createdAt", "updatedAt")
       SELECT uuid_generate_v4(), seed.name, seed.code, ar.id, now(), now()
       FROM provinces_seed seed
       CROSS JOIN ar
       WHERE NOT EXISTS (
         SELECT 1
         FROM "provinces" p
         WHERE p."countryId" = ar.id
           AND (
             upper(trim(p."name")) = upper(seed.name)
             OR upper(trim(coalesce(p."code", ''))) = upper(seed.code)
           )
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_cities_provinceId_normalizedName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cities" DROP COLUMN IF EXISTS "normalizedName"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_provinces_countryId_code"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_provinces_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "provinces" DROP COLUMN IF EXISTS "code"`,
    );
  }
}
