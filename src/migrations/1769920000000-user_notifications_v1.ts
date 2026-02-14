import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserNotificationsV11769920000000 implements MigrationInterface {
  name = 'UserNotificationsV11769920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "user_notifications_type_enum" AS ENUM(
        'challenge.received',
        'challenge.accepted',
        'challenge.rejected',
        'match.reported',
        'match.confirmed',
        'reservation.confirmed',
        'system'
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "user_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "type" "user_notifications_type_enum" NOT NULL,
        "title" character varying(200) NOT NULL,
        "body" text,
        "data" jsonb,
        "readAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_notifications" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_user_notifications_userId" ON "user_notifications" ("userId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_user_notifications_userId_createdAt" ON "user_notifications" ("userId", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_user_notifications_userId_readAt" ON "user_notifications" ("userId", "readAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_user_notifications_userId_readAt"`,
    );

    await queryRunner.query(
      `DROP INDEX "IDX_user_notifications_userId_createdAt"`,
    );

    await queryRunner.query(`DROP INDEX "IDX_user_notifications_userId"`);

    await queryRunner.query(`DROP TABLE "user_notifications"`);

    await queryRunner.query(`DROP TYPE "user_notifications_type_enum"`);
  }
}
