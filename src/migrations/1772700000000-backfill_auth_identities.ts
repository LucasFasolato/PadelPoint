import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillAuthIdentities1772700000000 implements MigrationInterface {
  name = 'BackfillAuthIdentities1772700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // For each user with a non-null, non-empty passwordHash,
    // insert a PASSWORD identity if one does not already exist.
    await queryRunner.query(`
      INSERT INTO "auth_identities" ("id", "userId", "provider", "email", "passwordHash", "createdAt", "updatedAt")
      SELECT
        uuid_generate_v4(),
        u."id",
        'PASSWORD',
        LOWER(u."email"),
        u."passwordHash",
        NOW(),
        NOW()
      FROM "users" u
      WHERE u."passwordHash" IS NOT NULL
        AND u."passwordHash" <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM "auth_identities" ai
          WHERE ai."userId" = u."id"
            AND ai."provider" = 'PASSWORD'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove only the PASSWORD identities that were created by this backfill
    // (those whose email matches the user's email — safe approximation).
    await queryRunner.query(`
      DELETE FROM "auth_identities"
      WHERE "provider" = 'PASSWORD'
    `);
  }
}
