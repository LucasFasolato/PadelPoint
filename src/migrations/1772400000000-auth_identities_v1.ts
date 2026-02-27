import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthIdentitiesV11772400000000 implements MigrationInterface {
  name = 'AuthIdentitiesV11772400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "auth_identities_provider_enum" AS ENUM('PASSWORD', 'GOOGLE', 'APPLE')`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_identities" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId"         uuid NOT NULL,
        "provider"       "auth_identities_provider_enum" NOT NULL,
        "providerUserId" character varying(255),
        "email"          character varying(120),
        "passwordHash"   character varying(120),
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_auth_identities" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "auth_identities" ADD CONSTRAINT "fk_auth_identities_user"
       FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_auth_identities_user_id" ON "auth_identities" ("userId")`,
    );

    // Unique: (provider, providerUserId) where providerUserId IS NOT NULL
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_identities_provider_provider_user_id"
       ON "auth_identities" ("provider", "providerUserId")
       WHERE "providerUserId" IS NOT NULL`,
    );

    // Unique: (provider='PASSWORD', email) where email IS NOT NULL
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_identities_password_email"
       ON "auth_identities" ("provider", "email")
       WHERE "provider" = 'PASSWORD' AND "email" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_auth_identities_password_email"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_auth_identities_provider_provider_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_auth_identities_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_identities" DROP CONSTRAINT IF EXISTS "fk_auth_identities_user"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_identities"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "auth_identities_provider_enum"`);
  }
}
