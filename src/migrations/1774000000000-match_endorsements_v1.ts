import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchEndorsementsV11774000000000 implements MigrationInterface {
  name = 'MatchEndorsementsV11774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'player_strength_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."player_strength_enum" AS ENUM(
            'SMASH',
            'BANDEJA',
            'VIBORA',
            'VOLEA',
            'GLOBO',
            'DEFENSA',
            'RESILIENCIA',
            'TACTICA',
            'COMUNICACION',
            'VELOCIDAD',
            'PRECISION'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "match_endorsements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "matchId" uuid NOT NULL,
        "fromUserId" uuid NOT NULL,
        "toUserId" uuid NOT NULL,
        "strengths" "public"."player_strength_enum"[] NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_match_endorsements_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_match_endorsements_match_from_to" UNIQUE ("matchId", "fromUserId", "toUserId"),
        CONSTRAINT "CHK_match_endorsements_strengths_len"
          CHECK (array_length("strengths", 1) BETWEEN 1 AND 2)
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_match_endorsements_match'
        ) THEN
          ALTER TABLE "match_endorsements"
          ADD CONSTRAINT "FK_match_endorsements_match"
          FOREIGN KEY ("matchId")
          REFERENCES "match_results"("id")
          ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_match_endorsements_from_user'
        ) THEN
          ALTER TABLE "match_endorsements"
          ADD CONSTRAINT "FK_match_endorsements_from_user"
          FOREIGN KEY ("fromUserId")
          REFERENCES "users"("id")
          ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_match_endorsements_to_user'
        ) THEN
          ALTER TABLE "match_endorsements"
          ADD CONSTRAINT "FK_match_endorsements_to_user"
          FOREIGN KEY ("toUserId")
          REFERENCES "users"("id")
          ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'UQ_match_endorsements_match_from_to'
        ) THEN
          ALTER TABLE "match_endorsements"
          ADD CONSTRAINT "UQ_match_endorsements_match_from_to"
          UNIQUE ("matchId", "fromUserId", "toUserId");
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'CHK_match_endorsements_strengths_len'
        ) THEN
          ALTER TABLE "match_endorsements"
          ADD CONSTRAINT "CHK_match_endorsements_strengths_len"
          CHECK (array_length("strengths", 1) BETWEEN 1 AND 2);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_match_endorsements_to_createdat"
      ON "match_endorsements" ("toUserId", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_match_endorsements_from_createdat"
      ON "match_endorsements" ("fromUserId", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_match_endorsements_matchid"
      ON "match_endorsements" ("matchId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_match_endorsements_matchid"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_match_endorsements_from_createdat"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_match_endorsements_to_createdat"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "match_endorsements"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."player_strength_enum"
    `);
  }
}
