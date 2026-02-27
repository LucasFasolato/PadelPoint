import { MigrationInterface, QueryRunner } from 'typeorm';

export class UsersCompetitiveBaseV11768306500000 implements MigrationInterface {
  name = 'UsersCompetitiveBaseV11768306500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'user_role_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."user_role_enum" AS ENUM('player', 'admin');
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(120) NOT NULL,
        "passwordHash" character varying(120),
        "role" "public"."user_role_enum" NOT NULL DEFAULT 'player',
        "displayName" character varying(80),
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_email" ON "users" ("email")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "competitive_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid,
        "elo" integer NOT NULL DEFAULT 1200,
        "initialCategory" integer,
        "categoryLocked" boolean NOT NULL DEFAULT false,
        "matchesPlayed" integer NOT NULL DEFAULT 0,
        "wins" integer NOT NULL DEFAULT 0,
        "losses" integer NOT NULL DEFAULT 0,
        "draws" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_profiles_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_competitive_profiles_userId" ON "competitive_profiles" ("userId")`,
    );

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_6a6e2e2804aaf5d2fa7d83f8fa5'
        ) THEN
          ALTER TABLE "competitive_profiles"
          ADD CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5"
          FOREIGN KEY ("userId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "elo_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "profileId" uuid,
        "eloBefore" integer NOT NULL DEFAULT 0,
        "eloAfter" integer NOT NULL DEFAULT 0,
        "delta" integer NOT NULL DEFAULT 0,
        "reason" character varying(40) NOT NULL DEFAULT 'match_result',
        "refId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_elo_history_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_9029f5325bc5061f6cb6e03568f'
        ) THEN
          ALTER TABLE "elo_history"
          ADD CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f"
          FOREIGN KEY ("profileId") REFERENCES "competitive_profiles"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_elo_history_profileId" ON "elo_history" ("profileId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_elo_history_profileId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "elo_history" DROP CONSTRAINT IF EXISTS "FK_9029f5325bc5061f6cb6e03568f"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "elo_history"`);
    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP CONSTRAINT IF EXISTS "FK_6a6e2e2804aaf5d2fa7d83f8fa5"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_competitive_profiles_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "competitive_profiles"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_users_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."user_role_enum"`);
  }
}
