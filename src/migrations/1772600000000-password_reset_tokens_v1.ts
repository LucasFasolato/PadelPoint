import { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordResetTokensV11772600000000 implements MigrationInterface {
  name = 'PasswordResetTokensV11772600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_reset_tokens" (
        "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"     uuid NOT NULL,
        "tokenHash"  character varying(255) NOT NULL,
        "expiresAt"  TIMESTAMP WITH TIME ZONE NOT NULL,
        "usedAt"     TIMESTAMP WITH TIME ZONE,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_password_reset_tokens" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "fk_password_reset_tokens_user"
       FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_password_reset_tokens_user_id" ON "password_reset_tokens" ("userId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_password_reset_tokens_token_hash" ON "password_reset_tokens" ("tokenHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_password_reset_tokens_token_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_password_reset_tokens_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "fk_password_reset_tokens_user"`,
    );
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
  }
}
