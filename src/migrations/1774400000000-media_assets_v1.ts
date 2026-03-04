import { MigrationInterface, QueryRunner } from 'typeorm';

export class MediaAssetsV11774400000000 implements MigrationInterface {
  name = 'MediaAssetsV11774400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t WHERE t.typname = 'media_assets_ownertype_enum'
        ) THEN
          CREATE TYPE "public"."media_assets_ownertype_enum" AS ENUM(
            'CLUB',
            'COURT',
            'USER'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t WHERE t.typname = 'media_assets_kind_enum'
        ) THEN
          CREATE TYPE "public"."media_assets_kind_enum" AS ENUM(
            'CLUB_LOGO',
            'CLUB_COVER',
            'COURT_PRIMARY',
            'COURT_GALLERY',
            'USER_AVATAR'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t WHERE t.typname = 'media_assets_provider_enum'
        ) THEN
          CREATE TYPE "public"."media_assets_provider_enum" AS ENUM('CLOUDINARY');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "media_assets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerType" "public"."media_assets_ownertype_enum" NOT NULL,
        "ownerId" uuid NOT NULL,
        "kind" "public"."media_assets_kind_enum" NOT NULL,
        "provider" "public"."media_assets_provider_enum" NOT NULL DEFAULT 'CLOUDINARY',
        "publicId" character varying(220) NULL,
        "url" text NULL,
        "secureUrl" text NULL,
        "bytes" integer NULL,
        "format" text NULL,
        "width" integer NULL,
        "height" integer NULL,
        "createdByUserId" uuid NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_assets_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_media_assets_owner_kind_active"
      ON "media_assets" ("ownerType", "ownerId", "kind", "active")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_media_assets_owner_kind_createdAt_desc"
      ON "media_assets" ("ownerType", "ownerId", "kind", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_media_assets_owner_kind_createdAt_desc"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_media_assets_owner_kind_active"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "media_assets"`);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."media_assets_provider_enum"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."media_assets_kind_enum"`);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."media_assets_ownertype_enum"
    `);
  }
}
