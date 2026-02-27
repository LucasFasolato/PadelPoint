import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompetitiveOnboardingFields1769910000000 implements MigrationInterface {
  name = 'CompetitiveOnboardingFields1769910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "competitive_profiles_primarygoal_enum" AS ENUM('improve', 'compete', 'socialize', 'stay_fit')`,
    );

    await queryRunner.query(
      `CREATE TYPE "competitive_profiles_playingfrequency_enum" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'occasional')`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" ADD COLUMN IF NOT EXISTS "primaryGoal" "competitive_profiles_primarygoal_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" ADD COLUMN IF NOT EXISTS "playingFrequency" "competitive_profiles_playingfrequency_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" ADD COLUMN IF NOT EXISTS "preferences" jsonb`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" ADD COLUMN IF NOT EXISTS "onboardingComplete" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP COLUMN IF EXISTS "onboardingComplete"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP COLUMN IF EXISTS "preferences"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP COLUMN IF EXISTS "playingFrequency"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP COLUMN IF EXISTS "primaryGoal"`,
    );

    await queryRunner.query(
      `DROP TYPE IF EXISTS "competitive_profiles_playingfrequency_enum"`,
    );

    await queryRunner.query(
      `DROP TYPE IF EXISTS "competitive_profiles_primarygoal_enum"`,
    );
  }
}
