import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeaguesIsPublicV11773800000000 implements MigrationInterface {
  name = 'LeaguesIsPublicV11773800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "leagues"
      ADD COLUMN IF NOT EXISTS "isPublic" boolean
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'leagues'
            AND column_name = 'isPublic'
        ) THEN
          UPDATE "leagues"
          SET "isPublic" = true
          WHERE "isPublic" IS NULL;

          ALTER TABLE "leagues"
          ALTER COLUMN "isPublic" SET DEFAULT true;

          ALTER TABLE "leagues"
          ALTER COLUMN "isPublic" SET NOT NULL;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "leagues"
      DROP COLUMN IF EXISTS "isPublic"
    `);
  }
}
