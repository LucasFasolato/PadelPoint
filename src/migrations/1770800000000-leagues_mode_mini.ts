import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeaguesModeMini1770800000000 implements MigrationInterface {
  name = 'LeaguesModeMini1770800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "leagues_mode_enum" ADD VALUE IF NOT EXISTS 'mini'`,
    );
  }

  public async down(_: QueryRunner): Promise<void> {}
}
