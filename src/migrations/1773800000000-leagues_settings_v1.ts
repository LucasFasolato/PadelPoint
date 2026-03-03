import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeaguesSettingsV11773800000000 implements MigrationInterface {
  name = 'LeaguesSettingsV11773800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add settings column as jsonb with NOT NULL constraint
    // This is idempotent: IF NOT EXISTS prevents errors on rerun
    await queryRunner.query(`
      ALTER TABLE "leagues" 
      ADD COLUMN IF NOT EXISTS "settings" jsonb
    `);

    // Backfill existing rows with empty object default
    // Only update rows where settings is NULL to avoid modifying existing data
    await queryRunner.query(`
      UPDATE "leagues" 
      SET "settings" = '{}'::jsonb 
      WHERE "settings" IS NULL
    `);

    // Add NOT NULL constraint and default value
    // Using a DO block to make this idempotent
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'leagues' AND column_name = 'settings'
            AND is_nullable = 'YES'
        ) THEN
          ALTER TABLE "leagues" 
          ALTER COLUMN "settings" SET NOT NULL;
        END IF;
      END $$;
    `);

    // Set default value (idempotent approach)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'leagues' AND column_name = 'settings'
            AND column_default IS NULL
        ) THEN
          ALTER TABLE "leagues" 
          ALTER COLUMN "settings" SET DEFAULT '{}'::jsonb;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leagues" DROP COLUMN IF EXISTS "settings"
    `);
  }
}
