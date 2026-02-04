import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakePaymentIntentUseridNullable1769901111111 implements MigrationInterface {
  name = 'MakePaymentIntentUseridNullable1769901111111';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_intents"
      ALTER COLUMN "userId" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // OJO: esto va a fallar si existen rows con userId NULL.
    // Si querés down seguro, primero seteá un userId válido en esos rows.
    await queryRunner.query(`
      ALTER TABLE "payment_intents"
      ALTER COLUMN "userId" SET NOT NULL
    `);
  }
}
