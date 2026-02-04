import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPhone1769900000000 implements MigrationInterface {
  name = 'AddUserPhone1769900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "phone" character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
  }
}
