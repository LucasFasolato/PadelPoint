import { MigrationInterface, QueryRunner } from 'typeorm';

export class DiscoverCandidatesIndexesV11773400000000
  implements MigrationInterface
{
  name = 'DiscoverCandidatesIndexesV11773400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_active_cityId"
      ON "users" ("active", "cityId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_challenges_direct_discover_lookup"
      ON "challenges" ("type", "status", "teamA1Id", "invitedOpponentId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_challenges_direct_discover_lookup_reverse"
      ON "challenges" ("type", "status", "invitedOpponentId", "teamA1Id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_challenges_direct_discover_lookup_reverse"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_challenges_direct_discover_lookup"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_users_active_cityId"
    `);
  }
}
