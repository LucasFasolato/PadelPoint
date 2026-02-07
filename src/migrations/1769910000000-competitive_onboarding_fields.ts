import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompetitiveOnboardingFields1769910000000
  implements MigrationInterface
{
  name = 'CompetitiveOnboardingFields1769910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "competitive_profiles_primarygoal_enum" AS ENUM('improve', 'compete', 'socialize', 'stay_fit')`,
    );

    await queryRunner.query(
      `CREATE TYPE "competitive_profiles_playingfrequency_enum" AS ENUM('daily', 'weekly', 'biweekly', 'monthly', 'occasional')`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" ADD "primaryGoal" "competitive_profiles_primarygoal_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" ADD "playingFrequency" "competitive_profiles_playingfrequency_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" ADD "preferences" jsonb`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" ADD "onboardingComplete" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP COLUMN "onboardingComplete"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP COLUMN "preferences"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP COLUMN "playingFrequency"`,
    );

    await queryRunner.query(
      `ALTER TABLE "competitive_profiles" DROP COLUMN "primaryGoal"`,
    );

    await queryRunner.query(
      `DROP TYPE "competitive_profiles_playingfrequency_enum"`,
    );

    await queryRunner.query(
      `DROP TYPE "competitive_profiles_primarygoal_enum"`,
    );
  }
}
