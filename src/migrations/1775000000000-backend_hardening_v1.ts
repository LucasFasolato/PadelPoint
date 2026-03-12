import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackendHardeningV11775000000000 implements MigrationInterface {
  name = 'BackendHardeningV11775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD COLUMN IF NOT EXISTS "tokenFamilyId" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD COLUMN IF NOT EXISTS "revoked" boolean
    `);

    await queryRunner.query(`
      UPDATE "refresh_tokens"
      SET "tokenFamilyId" = "id"
      WHERE "tokenFamilyId" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "refresh_tokens"
      SET "revoked" = CASE WHEN "revokedAt" IS NULL THEN false ELSE true END
      WHERE "revoked" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ALTER COLUMN "tokenFamilyId" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ALTER COLUMN "revoked" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ALTER COLUMN "revoked" SET DEFAULT false
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_token_family_id"
      ON "refresh_tokens" ("tokenFamilyId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_family"
      ON "refresh_tokens" ("userId", "tokenFamilyId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_family_revoked"
      ON "refresh_tokens" ("tokenFamilyId", "revoked")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_notifications_user_read_created_at"
      ON "user_notifications" ("userId", "readAt", "createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_court_availability_overrides_lookup"
      ON "court_availability_overrides"
      ("courtId", "fecha", "bloqueado", "horaInicio", "horaFin")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_court_availability_overrides_lookup"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_user_notifications_user_read_created_at"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_refresh_tokens_family_revoked"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_refresh_tokens_user_family"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."idx_refresh_tokens_token_family_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      DROP COLUMN IF EXISTS "revoked"
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      DROP COLUMN IF EXISTS "tokenFamilyId"
    `);
  }
}
