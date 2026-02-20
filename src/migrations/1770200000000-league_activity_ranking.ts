import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeagueActivityRanking1770200000000 implements MigrationInterface {
  name = 'LeagueActivityRanking1770200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "league_activity_type_enum" ADD VALUE IF NOT EXISTS 'rankings_updated'`,
    );
    await queryRunner.query(
      `ALTER TYPE "user_notifications_type_enum" ADD VALUE IF NOT EXISTS 'league.ranking_moved'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type.
    // The values are harmless if unused, so this is intentionally a no-op.
    await queryRunner.query(`SELECT 1`);
  }
}
