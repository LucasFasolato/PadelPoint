import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueAvatarPermanentAndAdminConfirm1772200000000
  implements MigrationInterface
{
  name = 'LeagueAvatarPermanentAndAdminConfirm1772200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "leagues" ADD "isPermanent" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "leagues" ADD "avatarMediaAssetId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "leagues" ADD "avatarUrl" character varying(600)`,
    );

    await queryRunner.query(
      `UPDATE "leagues" SET "isPermanent" = true WHERE "mode" IN ('open', 'mini')`,
    );

    await queryRunner.query(
      `ALTER TYPE "match_audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'admin_confirm'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "leagues" DROP COLUMN "avatarUrl"`);
    await queryRunner.query(
      `ALTER TABLE "leagues" DROP COLUMN "avatarMediaAssetId"`,
    );
    await queryRunner.query(`ALTER TABLE "leagues" DROP COLUMN "isPermanent"`);

    await queryRunner.query(
      `ALTER TYPE "match_audit_logs_action_enum" RENAME TO "match_audit_logs_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "match_audit_logs_action_enum" AS ENUM('dispute_raised', 'dispute_resolved')`,
    );
    await queryRunner.query(
      `ALTER TABLE "match_audit_logs" ALTER COLUMN "action" TYPE "match_audit_logs_action_enum" USING "action"::text::"match_audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "match_audit_logs_action_enum_old"`);
  }
}
