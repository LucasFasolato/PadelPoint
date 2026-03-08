import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChallengeCoordinationV11774800000000 implements MigrationInterface {
  name = 'ChallengeCoordinationV11774800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'challenge_coordination_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."challenge_coordination_status_enum" AS ENUM('accepted', 'coordinating', 'scheduled');
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "coordinationStatus" "public"."challenge_coordination_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "locationLabel" character varying(160)`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "clubId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "courtId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_coordinationStatus" ON "challenges" ("coordinationStatus")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_scheduledAt" ON "challenges" ("scheduledAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_clubId" ON "challenges" ("clubId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_courtId" ON "challenges" ("courtId")`,
    );

    const hasClubs = await queryRunner.hasTable('clubs');
    if (hasClubs) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_challenges_clubId_clubs'
          ) THEN
            ALTER TABLE "challenges"
            ADD CONSTRAINT "FK_challenges_clubId_clubs"
            FOREIGN KEY ("clubId") REFERENCES "clubs"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    const hasCourts = await queryRunner.hasTable('courts');
    if (hasCourts) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_challenges_courtId_courts'
          ) THEN
            ALTER TABLE "challenges"
            ADD CONSTRAINT "FK_challenges_courtId_courts"
            FOREIGN KEY ("courtId") REFERENCES "courts"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'challenge_schedule_proposals_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."challenge_schedule_proposals_status_enum" AS ENUM('pending', 'accepted', 'rejected', 'countered', 'withdrawn');
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "challenge_schedule_proposals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "challengeId" uuid NOT NULL,
        "proposedByUserId" uuid NOT NULL,
        "scheduledAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "locationLabel" character varying(160),
        "clubId" uuid,
        "courtId" uuid,
        "note" character varying(500),
        "status" "public"."challenge_schedule_proposals_status_enum" NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_challenge_schedule_proposals" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenge_schedule_proposals_challenge_createdAt" ON "challenge_schedule_proposals" ("challengeId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenge_schedule_proposals_challenge_status" ON "challenge_schedule_proposals" ("challengeId", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_challenge_schedule_proposals_one_pending" ON "challenge_schedule_proposals" ("challengeId") WHERE "status" = 'pending'`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "challenge_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "challengeId" uuid NOT NULL,
        "senderUserId" uuid NOT NULL,
        "message" character varying(500) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_challenge_messages" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenge_messages_challenge_createdAt" ON "challenge_messages" ("challengeId", "createdAt")`,
    );

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_challenge_schedule_proposals_challengeId'
        ) THEN
          ALTER TABLE "challenge_schedule_proposals"
          ADD CONSTRAINT "FK_challenge_schedule_proposals_challengeId"
          FOREIGN KEY ("challengeId") REFERENCES "challenges"("id")
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
          WHERE conname = 'FK_challenge_schedule_proposals_proposedByUserId'
        ) THEN
          ALTER TABLE "challenge_schedule_proposals"
          ADD CONSTRAINT "FK_challenge_schedule_proposals_proposedByUserId"
          FOREIGN KEY ("proposedByUserId") REFERENCES "users"("id")
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
          WHERE conname = 'FK_challenge_messages_challengeId'
        ) THEN
          ALTER TABLE "challenge_messages"
          ADD CONSTRAINT "FK_challenge_messages_challengeId"
          FOREIGN KEY ("challengeId") REFERENCES "challenges"("id")
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
          WHERE conname = 'FK_challenge_messages_senderUserId'
        ) THEN
          ALTER TABLE "challenge_messages"
          ADD CONSTRAINT "FK_challenge_messages_senderUserId"
          FOREIGN KEY ("senderUserId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;`,
    );

    if (hasClubs) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_challenge_schedule_proposals_clubId'
          ) THEN
            ALTER TABLE "challenge_schedule_proposals"
            ADD CONSTRAINT "FK_challenge_schedule_proposals_clubId"
            FOREIGN KEY ("clubId") REFERENCES "clubs"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }

    if (hasCourts) {
      await queryRunner.query(
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_challenge_schedule_proposals_courtId'
          ) THEN
            ALTER TABLE "challenge_schedule_proposals"
            ADD CONSTRAINT "FK_challenge_schedule_proposals_courtId"
            FOREIGN KEY ("courtId") REFERENCES "courts"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
          END IF;
        END $$;`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "challenge_schedule_proposals" DROP CONSTRAINT IF EXISTS "FK_challenge_schedule_proposals_courtId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge_schedule_proposals" DROP CONSTRAINT IF EXISTS "FK_challenge_schedule_proposals_clubId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge_messages" DROP CONSTRAINT IF EXISTS "FK_challenge_messages_senderUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge_messages" DROP CONSTRAINT IF EXISTS "FK_challenge_messages_challengeId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge_schedule_proposals" DROP CONSTRAINT IF EXISTS "FK_challenge_schedule_proposals_proposedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenge_schedule_proposals" DROP CONSTRAINT IF EXISTS "FK_challenge_schedule_proposals_challengeId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenge_messages_challenge_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "challenge_messages"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenge_schedule_proposals_one_pending"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenge_schedule_proposals_challenge_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenge_schedule_proposals_challenge_createdAt"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "challenge_schedule_proposals"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_challenges_courtId_courts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_challenges_clubId_clubs"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_courtId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_clubId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_scheduledAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_coordinationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP COLUMN IF EXISTS "courtId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP COLUMN IF EXISTS "clubId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP COLUMN IF EXISTS "locationLabel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP COLUMN IF EXISTS "scheduledAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP COLUMN IF EXISTS "coordinationStatus"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."challenge_schedule_proposals_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."challenge_coordination_status_enum"`,
    );
  }
}
