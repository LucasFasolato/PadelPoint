import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakePasswordHashNullable1772300000000 implements MigrationInterface {
  name = 'MakePasswordHashNullable1772300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-set a placeholder for any null rows before re-adding NOT NULL
    await queryRunner.query(
      `UPDATE "users" SET "passwordHash" = '' WHERE "passwordHash" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "passwordHash" SET NOT NULL`,
    );
  }
}
