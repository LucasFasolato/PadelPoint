import { MigrationInterface, QueryRunner } from 'typeorm';

export class ActivityFeedV11773200000000 implements MigrationInterface {
  name = 'ActivityFeedV11773200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "user_notifications_type_enum" ADD VALUE IF NOT EXISTS 'ranking.snapshot_published'`,
    );
    await queryRunner.query(
      `ALTER TYPE "user_notifications_type_enum" ADD VALUE IF NOT EXISTS 'ranking.movement'`,
    );

    await queryRunner.query(
      `ALTER TABLE "user_notifications" ALTER COLUMN "userId" DROP NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_notifications_createdAt_id" ON "user_notifications" ("createdAt" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_notifications_global_feed" ON "user_notifications" ("createdAt" DESC, "id" DESC) WHERE "userId" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_notifications_user_feed" ON "user_notifications" ("userId", "createdAt" DESC, "id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_user_notifications_user_feed"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_user_notifications_global_feed"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_user_notifications_createdAt_id"`,
    );

    await queryRunner.query(
      `DELETE FROM "user_notifications" WHERE "userId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_notifications" ALTER COLUMN "userId" SET NOT NULL`,
    );

    // PostgreSQL cannot remove enum values safely once added.
    await queryRunner.query(`SELECT 1`);
  }
}
