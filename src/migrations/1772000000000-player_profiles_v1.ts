import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayerProfilesV11772000000000 implements MigrationInterface {
  name = 'PlayerProfilesV11772000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "player_profiles" (
        "userId" uuid NOT NULL,
        "bio" character varying(240),
        "playStyleTags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "strengths" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "lookingFor" jsonb NOT NULL DEFAULT '{"partner":false,"rival":false}'::jsonb,
        "location" jsonb,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_player_profiles_userId" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_player_profiles_userId_users_id"
          FOREIGN KEY ("userId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "player_profiles"`);
  }
}
