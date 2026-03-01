/**
 * Diagnostic script: reproduce the GET /leagues raw query for a given userId.
 *
 * Usage:
 *   DATABASE_URL=postgres://... ts-node -r tsconfig-paths/register scripts/diagnose-leagues-list.ts <userId>
 *
 * Prints the raw rows returned by the my-leagues-list query so you can
 * inspect column names, null joins, and enum values that may cause mapping errors.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { join } from 'path';

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: ts-node scripts/diagnose-leagues-list.ts <userId>');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL env variable is required');
    process.exit(1);
  }

  const sslEnabled = ['require', 'verify-ca', 'verify-full'].includes(
    (process.env.PGSSLMODE ?? '').trim().toLowerCase(),
  );

  const ds = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    synchronize: false,
    logging: false,
    entities: [join(__dirname, '..', 'src', '**', '*.entity.{js,ts}')],
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  });

  await ds.initialize();
  console.log('[diagnose] Connected to DB');

  try {
    const rows = await ds.query(
      `
      SELECT
        l.id                                         AS id,
        l.name                                       AS name,
        l.mode                                       AS mode,
        l.status                                     AS status,
        "myMember".role                              AS role,
        city.name                                    AS "cityName",
        province.code                                AS "provinceCode",
        (SELECT COUNT(1)
           FROM league_member lm
          WHERE lm."leagueId" = l.id)               AS "membersCount",
        (SELECT MAX(la."createdAt")
           FROM league_activity la
          WHERE la."leagueId" = l.id)               AS "lastActivityAt"
      FROM league l
      INNER JOIN league_member "myMember"
        ON "myMember"."leagueId" = l.id
       AND "myMember"."userId" = $1
      LEFT JOIN "user" creator
        ON creator.id = l."creatorId"
      LEFT JOIN city
        ON city.id = creator."cityId"
      LEFT JOIN province
        ON province.id = city."provinceId"
      ORDER BY
        COALESCE(
          (SELECT MAX(la."createdAt") FROM league_activity la WHERE la."leagueId" = l.id),
          l."createdAt"
        ) DESC,
        l.id DESC
      `,
      [userId],
    );

    console.log(`[diagnose] userId=${userId} → ${rows.length} row(s)`);

    if (rows.length === 0) {
      console.log('[diagnose] No leagues found for this user.');
    } else {
      rows.forEach((row: Record<string, unknown>, i: number) => {
        console.log(`\n--- Row ${i} ---`);
        for (const [key, val] of Object.entries(row)) {
          const type = val === null ? 'null' : typeof val;
          console.log(`  ${key}: ${JSON.stringify(val)} (${type})`);
        }
      });
    }
  } catch (err) {
    console.error('[diagnose] Query failed:', err);
  } finally {
    await ds.destroy();
    console.log('\n[diagnose] Done.');
  }
}

void main();
