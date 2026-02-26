import { MigrationInterface, QueryRunner } from 'typeorm';

export class GeoCityScopeV11772800000000 implements MigrationInterface {
  name = 'GeoCityScopeV11772800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "countries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(120) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_countries_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "provinces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(120) NOT NULL, "countryId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_provinces_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_provinces_countryId" ON "provinces" ("countryId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(120) NOT NULL, "provinceId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cities_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cities_provinceId" ON "cities" ("provinceId") `,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "cityId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_cityId" ON "users" ("cityId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "provinces" ADD CONSTRAINT "FK_provinces_countryId" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cities" ADD CONSTRAINT "FK_cities_provinceId" FOREIGN KEY ("provinceId") REFERENCES "provinces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_cityId" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_users_cityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cities" DROP CONSTRAINT "FK_cities_provinceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "provinces" DROP CONSTRAINT "FK_provinces_countryId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_users_cityId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "cityId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cities_provinceId"`);
    await queryRunner.query(`DROP TABLE "cities"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_provinces_countryId"`);
    await queryRunner.query(`DROP TABLE "provinces"`);
    await queryRunner.query(`DROP TABLE "countries"`);
  }
}
