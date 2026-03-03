import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueMembersRoleV11773600000000 implements MigrationInterface {
  name = 'LeagueMembersRoleV11773600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          INNER JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'league_members_role_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."league_members_role_enum" AS ENUM ('owner', 'admin', 'member');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_members"
      ADD COLUMN IF NOT EXISTS "role" "public"."league_members_role_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_members"
      ALTER COLUMN "role" SET DEFAULT 'member'::"public"."league_members_role_enum"
    `);

    await queryRunner.query(`
      UPDATE "league_members" AS lm
      SET "role" = 'owner'::"public"."league_members_role_enum"
      FROM "leagues" AS l
      WHERE lm."leagueId" = l."id"
        AND lm."userId" = l."creatorId"
    `);

    await queryRunner.query(`
      UPDATE "league_members"
      SET "role" = 'member'::"public"."league_members_role_enum"
      WHERE "role" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_members"
      ALTER COLUMN "role" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "league_members"
      DROP COLUMN IF EXISTS "role"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."league_members_role_enum"
    `);
  }
}
