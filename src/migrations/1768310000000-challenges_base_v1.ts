import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChallengesBaseV11768310000000 implements MigrationInterface {
  name = 'ChallengesBaseV11768310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasChallenges = await queryRunner.hasTable('challenges');
    if (hasChallenges) return;

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'challenges_type_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."challenges_type_enum" AS ENUM('direct', 'open');
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
          WHERE t.typname = 'challenges_status_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."challenges_status_enum" AS ENUM('pending', 'accepted', 'ready', 'rejected', 'cancelled');
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
          WHERE t.typname = 'match_type_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."match_type_enum" AS ENUM('COMPETITIVE', 'FRIENDLY');
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "challenges" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" "public"."challenges_type_enum" NOT NULL,
        "status" "public"."challenges_status_enum" NOT NULL DEFAULT 'pending',
        "matchType" "public"."match_type_enum" NOT NULL DEFAULT 'COMPETITIVE',
        "teamA1Id" uuid,
        "teamA2Id" uuid,
        "teamB1Id" uuid,
        "teamB2Id" uuid,
        "invitedOpponentId" uuid,
        "reservationId" uuid,
        "targetCategory" integer,
        "message" character varying(280),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_challenges_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_type" ON "challenges" ("type") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_status" ON "challenges" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_teamA1Id" ON "challenges" ("teamA1Id") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_teamA2Id" ON "challenges" ("teamA2Id") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_teamB1Id" ON "challenges" ("teamB1Id") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_teamB2Id" ON "challenges" ("teamB2Id") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_invitedOpponentId" ON "challenges" ("invitedOpponentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_challenges_reservationId" ON "challenges" ("reservationId") `,
    );

    const hasUsers = await queryRunner.hasTable('users');
    if (hasUsers) {
      await queryRunner.query(
        `ALTER TABLE "challenges" ADD CONSTRAINT "FK_72fe96340077853eb020672bd71" FOREIGN KEY ("teamA1Id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
      await queryRunner.query(
        `ALTER TABLE "challenges" ADD CONSTRAINT "FK_challenges_teamA2Id_users" FOREIGN KEY ("teamA2Id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
      await queryRunner.query(
        `ALTER TABLE "challenges" ADD CONSTRAINT "FK_challenges_teamB1Id_users" FOREIGN KEY ("teamB1Id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
      await queryRunner.query(
        `ALTER TABLE "challenges" ADD CONSTRAINT "FK_challenges_teamB2Id_users" FOREIGN KEY ("teamB2Id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
      await queryRunner.query(
        `ALTER TABLE "challenges" ADD CONSTRAINT "FK_challenges_invitedOpponentId_users" FOREIGN KEY ("invitedOpponentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasChallenges = await queryRunner.hasTable('challenges');
    if (!hasChallenges) return;

    await queryRunner.query(
      `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_challenges_invitedOpponentId_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_challenges_teamB2Id_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_challenges_teamB1Id_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_challenges_teamA2Id_users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP CONSTRAINT IF EXISTS "FK_72fe96340077853eb020672bd71"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_reservationId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_invitedOpponentId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_teamB2Id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_teamB1Id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_teamA2Id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_teamA1Id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_challenges_type"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "challenges"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."challenges_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."challenges_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."match_type_enum"`);
  }
}
