import { MigrationInterface, QueryRunner } from "typeorm";

export class ChallengeInvitesAndFkIds1768310821330 implements MigrationInterface {
    name = 'ChallengeInvitesAndFkIds1768310821330'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."challenge_invites_status_enum" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'expired')`);
        await queryRunner.query(`CREATE TABLE "challenge_invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "challengeId" uuid NOT NULL, "inviterId" uuid NOT NULL, "inviteeId" uuid NOT NULL, "status" "public"."challenge_invites_status_enum" NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_076e096a0d43aaa9cf6b6afd690" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4f13c986754853e87a8699120c" ON "challenge_invites" ("challengeId", "inviteeId") `);
        await queryRunner.query(`ALTER TABLE "challenges" DROP CONSTRAINT "FK_72fe96340077853eb020672bd71"`);
        await queryRunner.query(`ALTER TABLE "challenges" ALTER COLUMN "teamA1Id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "challenges" ADD CONSTRAINT "FK_72fe96340077853eb020672bd71" FOREIGN KEY ("teamA1Id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "challenge_invites" ADD CONSTRAINT "FK_a2bd2fa6986bd73b724a69ebb6e" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "challenge_invites" ADD CONSTRAINT "FK_e627e345d9871a8b4ed65ce025c" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "challenge_invites" ADD CONSTRAINT "FK_d92746e4b0633eb46b05b74a769" FOREIGN KEY ("inviteeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "challenge_invites" DROP CONSTRAINT "FK_d92746e4b0633eb46b05b74a769"`);
        await queryRunner.query(`ALTER TABLE "challenge_invites" DROP CONSTRAINT "FK_e627e345d9871a8b4ed65ce025c"`);
        await queryRunner.query(`ALTER TABLE "challenge_invites" DROP CONSTRAINT "FK_a2bd2fa6986bd73b724a69ebb6e"`);
        await queryRunner.query(`ALTER TABLE "challenges" DROP CONSTRAINT "FK_72fe96340077853eb020672bd71"`);
        await queryRunner.query(`ALTER TABLE "challenges" ALTER COLUMN "teamA1Id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "challenges" ADD CONSTRAINT "FK_72fe96340077853eb020672bd71" FOREIGN KEY ("teamA1Id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4f13c986754853e87a8699120c"`);
        await queryRunner.query(`DROP TABLE "challenge_invites"`);
        await queryRunner.query(`DROP TYPE "public"."challenge_invites_status_enum"`);
    }

}
