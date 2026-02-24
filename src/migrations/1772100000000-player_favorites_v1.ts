import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayerFavoritesV11772100000000 implements MigrationInterface {
  name = 'PlayerFavoritesV11772100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "player_favorites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "favoriteUserId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_player_favorites_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_player_favorites_userId_users_id"
          FOREIGN KEY ("userId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_player_favorites_favoriteUserId_users_id"
          FOREIGN KEY ("favoriteUserId") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_player_favorites_user_target"
      ON "player_favorites" ("userId", "favoriteUserId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_player_favorites_user_created_id_desc"
      ON "player_favorites" ("userId", "createdAt" DESC, "id" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_player_favorites_user_created_id_desc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_player_favorites_user_target"`,
    );
    await queryRunner.query(`DROP TABLE "player_favorites"`);
  }
}
