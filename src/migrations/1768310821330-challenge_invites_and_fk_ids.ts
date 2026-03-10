import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChallengeInvitesAndFkIds1768310821330 implements MigrationInterface {
  name = 'ChallengeInvitesAndFkIds1768310821330';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'challenge_invites_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."challenge_invites_status_enum" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'expired');
        END IF;
      END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "challenge_invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "challengeId" uuid NOT NULL, "inviterId" uuid NOT NULL, "inviteeId" uuid NOT NULL, "status" "public"."challenge_invites_status_enum" NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_076e096a0d43aaa9cf6b6afd690" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_4f13c986754853e87a8699120c" ON "challenge_invites" ("challengeId", "inviteeId") `,
    );

    const hasChallenges = await queryRunner.hasTable('challenges');
    const hasUsers = await queryRunner.hasTable('users');

    if (hasChallenges) {
      await queryRunner.query(
        `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_72fe96340077853eb020672bd71"`,
      );
      await queryRunner.query(
        `ALTER TABLE "challenges" ALTER COLUMN "teamA1Id" SET NOT NULL`,
      );
    }

    if (hasChallenges && hasUsers) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_72fe96340077853eb020672bd71'
          ) THEN
            ALTER TABLE "challenges"
            ADD CONSTRAINT "FK_72fe96340077853eb020672bd71"
            FOREIGN KEY ("teamA1Id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    if (hasChallenges) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_a2bd2fa6986bd73b724a69ebb6e'
          ) THEN
            ALTER TABLE "challenge_invites"
            ADD CONSTRAINT "FK_a2bd2fa6986bd73b724a69ebb6e"
            FOREIGN KEY ("challengeId") REFERENCES "challenges"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    if (hasUsers) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_e627e345d9871a8b4ed65ce025c'
          ) THEN
            ALTER TABLE "challenge_invites"
            ADD CONSTRAINT "FK_e627e345d9871a8b4ed65ce025c"
            FOREIGN KEY ("inviterId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_d92746e4b0633eb46b05b74a769'
          ) THEN
            ALTER TABLE "challenge_invites"
            ADD CONSTRAINT "FK_d92746e4b0633eb46b05b74a769"
            FOREIGN KEY ("inviteeId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasChallengeInvites = await queryRunner.hasTable('challenge_invites');
    const hasChallenges = await queryRunner.hasTable('challenges');
    const hasUsers = await queryRunner.hasTable('users');

    if (hasChallengeInvites) {
      await queryRunner.query(
        `ALTER TABLE "challenge_invites" DROP CONSTRAINT IF EXISTS "FK_d92746e4b0633eb46b05b74a769"`,
      );
      await queryRunner.query(
        `ALTER TABLE "challenge_invites" DROP CONSTRAINT IF EXISTS "FK_e627e345d9871a8b4ed65ce025c"`,
      );
      await queryRunner.query(
        `ALTER TABLE "challenge_invites" DROP CONSTRAINT IF EXISTS "FK_a2bd2fa6986bd73b724a69ebb6e"`,
      );
    }

    if (hasChallenges) {
      await queryRunner.query(
        `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_72fe96340077853eb020672bd71"`,
      );
      await queryRunner.query(
        `ALTER TABLE "challenges" ALTER COLUMN "teamA1Id" DROP NOT NULL`,
      );
    }

    if (hasChallenges && hasUsers) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_72fe96340077853eb020672bd71'
          ) THEN
            ALTER TABLE "challenges"
            ADD CONSTRAINT "FK_72fe96340077853eb020672bd71"
            FOREIGN KEY ("teamA1Id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_4f13c986754853e87a8699120c"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "challenge_invites"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."challenge_invites_status_enum"`,
    );
  }
}
