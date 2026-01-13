import { MigrationInterface, QueryRunner } from "typeorm";

export class CompetitiveEloV11768307545381 implements MigrationInterface {
    name = 'CompetitiveEloV11768307545381'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "match_results" ADD "eloApplied" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "competitive_profiles" DROP CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5"`);
        await queryRunner.query(`ALTER TABLE "competitive_profiles" ALTER COLUMN "userId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "elo_history" DROP CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f"`);
        await queryRunner.query(`ALTER TABLE "elo_history" ALTER COLUMN "profileId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "elo_history" DROP COLUMN "reason"`);
        await queryRunner.query(`CREATE TYPE "public"."elo_history_reason_enum" AS ENUM('init_category', 'match_result')`);
        await queryRunner.query(`ALTER TABLE "elo_history" ADD "reason" "public"."elo_history_reason_enum" NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_0319cff089411aec8ba3e50486" ON "elo_history" ("reason", "refId") `);
        await queryRunner.query(`CREATE INDEX "IDX_dc4360ccd457ec7370c99a9b45" ON "elo_history" ("profileId", "reason", "refId") `);
        await queryRunner.query(`ALTER TABLE "competitive_profiles" ADD CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "elo_history" ADD CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f" FOREIGN KEY ("profileId") REFERENCES "competitive_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "elo_history" DROP CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f"`);
        await queryRunner.query(`ALTER TABLE "competitive_profiles" DROP CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc4360ccd457ec7370c99a9b45"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0319cff089411aec8ba3e50486"`);
        await queryRunner.query(`ALTER TABLE "elo_history" DROP COLUMN "reason"`);
        await queryRunner.query(`DROP TYPE "public"."elo_history_reason_enum"`);
        await queryRunner.query(`ALTER TABLE "elo_history" ADD "reason" character varying(40) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "elo_history" ALTER COLUMN "profileId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "elo_history" ADD CONSTRAINT "FK_9029f5325bc5061f6cb6e03568f" FOREIGN KEY ("profileId") REFERENCES "competitive_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "competitive_profiles" ALTER COLUMN "userId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "competitive_profiles" ADD CONSTRAINT "FK_6a6e2e2804aaf5d2fa7d83f8fa5" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "match_results" DROP COLUMN "eloApplied"`);
    }

}
