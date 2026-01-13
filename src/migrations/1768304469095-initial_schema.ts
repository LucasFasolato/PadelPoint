import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1768304469095 implements MigrationInterface {
    name = 'InitialSchema1768304469095'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('player', 'admin_club', 'admin')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(120) NOT NULL, "passwordHash" character varying(120) NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'player', "displayName" character varying(80), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE TABLE "clubs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" character varying(120) NOT NULL, "direccion" character varying(200) NOT NULL, "telefono" character varying(30) NOT NULL, "email" character varying(160) NOT NULL, "latitud" numeric(10,7), "longitud" numeric(10,7), "activo" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bb09bd0c8d5238aeaa8f86ee0d4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_271ab18fa06d3f527f9b3d0bb0" ON "clubs" ("email") `);
        await queryRunner.query(`CREATE TABLE "courts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" character varying(120) NOT NULL, "superficie" character varying(60) NOT NULL, "precioPorHora" numeric(10,2) NOT NULL, "activa" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "clubId" uuid NOT NULL, CONSTRAINT "PK_948a5d356c3083f3237ecbf9897" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."reservations_status_enum" AS ENUM('hold', 'confirmed', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "startAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endAt" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."reservations_status_enum" NOT NULL DEFAULT 'hold', "expiresAt" TIMESTAMP WITH TIME ZONE, "clienteNombre" character varying(120) NOT NULL, "clienteEmail" character varying(120), "clienteTelefono" character varying(40), "precio" numeric(10,2) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courtId" uuid NOT NULL, CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dc338c2cd9b6d374be327c73d3" ON "reservations" ("courtId", "startAt", "endAt") `);
        await queryRunner.query(`CREATE TABLE "competitive_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "elo" integer NOT NULL DEFAULT '1200', "initialCategory" integer, "categoryLocked" boolean NOT NULL DEFAULT false, "matchesPlayed" integer NOT NULL DEFAULT '0', "wins" integer NOT NULL DEFAULT '0', "losses" integer NOT NULL DEFAULT '0', "draws" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" uuid, CONSTRAINT "REL_6a6e2e2804aaf5d2fa7d83f8fa" UNIQUE ("userId"), CONSTRAINT "PK_355229c64a1d2082561666e5660" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6a6e2e2804aaf5d2fa7d83f8fa" ON "competitive_profiles" ("userId") `);
        await queryRunner.query(`CREATE TABLE "elo_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "eloBefore" integer NOT NULL, "eloAfter" integer NOT NULL, "delta" integer NOT NULL, "reason" character varying(40) NOT NULL, "refId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "profileId" uuid, CONSTRAINT "PK_db7ab79cbc57f1616c8c3c575a5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9029f5325bc5061f6cb6e03568" ON "elo_history" ("profileId") `);
        await queryRunner.query(`CREATE TYPE "public"."challenges_type_enum" AS ENUM('direct', 'open')`);
        await queryRunner.query(`CREATE TYPE "public"."challenges_status_enum" AS ENUM('pending', 'accepted', 'ready', 'rejected', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "challenges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" "public"."challenges_type_enum" NOT NULL, "status" "public"."challenges_status_enum" NOT NULL DEFAULT 'pending', "reservationId" uuid, "targetCategory" integer, "message" character varying(280), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "teamA1Id" uuid, "teamA2Id" uuid, "teamB1Id" uuid, "teamB2Id" uuid, "invitedOpponentId" uuid, CONSTRAINT "PK_1e664e93171e20fe4d6125466af" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_72fe96340077853eb020672bd7" ON "challenges" ("teamA1Id") `);
        await queryRunner.query(`CREATE INDEX "IDX_a0554731a39999619c7bf6d240" ON "challenges" ("teamA2Id") `);
        await queryRunner.query(`CREATE INDEX "IDX_4e8139ed6775e26e9370fc17c0" ON "challenges" ("teamB1Id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ffad7ca06c6193a0a78575efbc" ON "challenges" ("teamB2Id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e12071273253864d7eebd3286e" ON "challenges" ("invitedOpponentId") `);
        await queryRunner.query(`CREATE TABLE "court_availability_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "diaSemana" integer NOT NULL, "horaInicio" character varying(5) NOT NULL, "horaFin" character varying(5) NOT NULL, "slotMinutos" integer NOT NULL DEFAULT '60', "activo" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courtId" uuid NOT NULL, CONSTRAINT "PK_0de91f8187d3c4c0fe25a5973e8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5b70b7429560d0d5f9741bc6e7" ON "court_availability_rules" ("courtId", "diaSemana", "horaInicio") `);
        await queryRunner.query(`CREATE TABLE "court_availability_overrides" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fecha" date NOT NULL, "horaInicio" TIME NOT NULL, "horaFin" TIME NOT NULL, "bloqueado" boolean NOT NULL DEFAULT true, "motivo" character varying(200), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courtId" uuid NOT NULL, CONSTRAINT "PK_b5ee1322dfdf610e88f3eb64199" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9fbbce0c2ed3ae82021977aed6" ON "court_availability_overrides" ("courtId", "fecha", "horaInicio", "horaFin") `);
        await queryRunner.query(`ALTER TABLE "courts" ADD CONSTRAINT "FK_bd5bede86cbaa95f457c8d4c3b7" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reservations" ADD CONSTRAINT "FK_8e8a5ee8b1cccfc35d3c596e82d" FOREIGN KEY ("courtId") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "competitive_profiles" ADD CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "elo_history" ADD CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f" FOREIGN KEY ("profileId") REFERENCES "competitive_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "challenges" ADD CONSTRAINT "FK_72fe96340077853eb020672bd71" FOREIGN KEY ("teamA1Id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "challenges" ADD CONSTRAINT "FK_a0554731a39999619c7bf6d2406" FOREIGN KEY ("teamA2Id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "challenges" ADD CONSTRAINT "FK_4e8139ed6775e26e9370fc17c0d" FOREIGN KEY ("teamB1Id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "challenges" ADD CONSTRAINT "FK_ffad7ca06c6193a0a78575efbc3" FOREIGN KEY ("teamB2Id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "challenges" ADD CONSTRAINT "FK_e12071273253864d7eebd3286e3" FOREIGN KEY ("invitedOpponentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "court_availability_rules" ADD CONSTRAINT "FK_e9e9637855bad9114a8aa368935" FOREIGN KEY ("courtId") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "court_availability_overrides" ADD CONSTRAINT "FK_b59df6fe9e3ac04e8587e8a97db" FOREIGN KEY ("courtId") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "court_availability_overrides" DROP CONSTRAINT "FK_b59df6fe9e3ac04e8587e8a97db"`);
        await queryRunner.query(`ALTER TABLE "court_availability_rules" DROP CONSTRAINT "FK_e9e9637855bad9114a8aa368935"`);
        await queryRunner.query(`ALTER TABLE "challenges" DROP CONSTRAINT "FK_e12071273253864d7eebd3286e3"`);
        await queryRunner.query(`ALTER TABLE "challenges" DROP CONSTRAINT "FK_ffad7ca06c6193a0a78575efbc3"`);
        await queryRunner.query(`ALTER TABLE "challenges" DROP CONSTRAINT "FK_4e8139ed6775e26e9370fc17c0d"`);
        await queryRunner.query(`ALTER TABLE "challenges" DROP CONSTRAINT "FK_a0554731a39999619c7bf6d2406"`);
        await queryRunner.query(`ALTER TABLE "challenges" DROP CONSTRAINT "FK_72fe96340077853eb020672bd71"`);
        await queryRunner.query(`ALTER TABLE "elo_history" DROP CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f"`);
        await queryRunner.query(`ALTER TABLE "competitive_profiles" DROP CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5"`);
        await queryRunner.query(`ALTER TABLE "reservations" DROP CONSTRAINT "FK_8e8a5ee8b1cccfc35d3c596e82d"`);
        await queryRunner.query(`ALTER TABLE "courts" DROP CONSTRAINT "FK_bd5bede86cbaa95f457c8d4c3b7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9fbbce0c2ed3ae82021977aed6"`);
        await queryRunner.query(`DROP TABLE "court_availability_overrides"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5b70b7429560d0d5f9741bc6e7"`);
        await queryRunner.query(`DROP TABLE "court_availability_rules"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e12071273253864d7eebd3286e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ffad7ca06c6193a0a78575efbc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4e8139ed6775e26e9370fc17c0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a0554731a39999619c7bf6d240"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_72fe96340077853eb020672bd7"`);
        await queryRunner.query(`DROP TABLE "challenges"`);
        await queryRunner.query(`DROP TYPE "public"."challenges_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."challenges_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9029f5325bc5061f6cb6e03568"`);
        await queryRunner.query(`DROP TABLE "elo_history"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6a6e2e2804aaf5d2fa7d83f8fa"`);
        await queryRunner.query(`DROP TABLE "competitive_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc338c2cd9b6d374be327c73d3"`);
        await queryRunner.query(`DROP TABLE "reservations"`);
        await queryRunner.query(`DROP TYPE "public"."reservations_status_enum"`);
        await queryRunner.query(`DROP TABLE "courts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_271ab18fa06d3f527f9b3d0bb0"`);
        await queryRunner.query(`DROP TABLE "clubs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
