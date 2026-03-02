/**
 * Diagnostic script: reproduce GET /leagues raw query for one user and detect
 * row-level anomalies that may break mapping.
 *
 * Usage:
 *   DATABASE_URL=postgres://... ts-node -r tsconfig-paths/register scripts/diagnose-leagues-list.ts <userId>
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { join } from 'path';

type RawLeagueRow = {
  id: unknown;
  name: unknown;
  mode: unknown;
  status: unknown;
  role: unknown;
  cityName: unknown;
  provinceCode: unknown;
  membersCount: unknown;
  lastActivityAt: unknown;
};

const VALID_MODE = new Set(['open', 'scheduled', 'mini']);
const VALID_STATUS = new Set(['draft', 'upcoming', 'active', 'finished']);
const VALID_ROLE = new Set(['owner', 'admin', 'member']);

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSafeInteger(value: unknown): number | null {
  if (typeof value === 'bigint') {
    if (value <= 0n) return 0;
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(value > maxSafe ? maxSafe : value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? null : Math.max(0, parsed);
  }
  return null;
}

function toNullableIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isMissingLeagueActivityRelation(err: unknown): boolean {
  const anyErr = err as {
    code?: unknown;
    message?: unknown;
    driverError?: { code?: unknown; message?: unknown };
  };
  const code = String(anyErr?.driverError?.code ?? anyErr?.code ?? '');
  const message = String(
    anyErr?.driverError?.message ?? anyErr?.message ?? '',
  ).toLowerCase();
  return code === '42P01' && message.includes('league_activity');
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );
}

function analyzeRow(row: RawLeagueRow, index: number) {
  const issues: string[] = [];
  const warnings: string[] = [];

  const id = normalizeString(row.id);
  if (!id) issues.push('id is null/empty or non-string');

  const mode = normalizeString(row.mode)?.toLowerCase();
  if (!mode) {
    warnings.push('mode is null/empty -> will fallback to SCHEDULED');
  } else if (!VALID_MODE.has(mode)) {
    warnings.push(`mode unexpected value: ${mode}`);
  }

  const status = normalizeString(row.status)?.toLowerCase();
  if (!status) {
    warnings.push('status is null/empty -> will fallback to UPCOMING');
  } else if (!VALID_STATUS.has(status)) {
    warnings.push(`status unexpected value: ${status}`);
  }

  const role = normalizeString(row.role)?.toLowerCase();
  if (role && !VALID_ROLE.has(role)) {
    warnings.push(`role unexpected value: ${role}`);
  }

  const membersCount = toSafeInteger(row.membersCount);
  if (row.membersCount !== null && row.membersCount !== undefined && membersCount === null) {
    warnings.push('membersCount has non-integer value');
  }

  const lastActivityIso = toNullableIsoString(row.lastActivityAt);
  if (
    row.lastActivityAt !== null &&
    row.lastActivityAt !== undefined &&
    lastActivityIso === null
  ) {
    warnings.push('lastActivityAt is present but not parseable as timestamp');
  }

  // Simulate common unsafe operations used in legacy mappers.
  const riskyOps: Array<{ name: string; run: () => unknown }> = [
    {
      name: 'id.trim()',
      run: () => (row.id as string).trim(),
    },
    {
      name: 'mode.localeCompare("open")',
      run: () => (row.mode as string).localeCompare('open'),
    },
    {
      name: 'new Date(lastActivityAt).toISOString()',
      run: () => new Date(row.lastActivityAt as string).toISOString(),
    },
  ];
  for (const op of riskyOps) {
    try {
      void op.run();
    } catch (err) {
      issues.push(`${op.name} throws: ${getErrorMessage(err)}`);
    }
  }

  return {
    index,
    rowSample: {
      id,
      mode: mode ?? null,
      status: status ?? null,
      role: role ?? null,
      cityName: normalizeString(row.cityName),
      provinceCode: normalizeString(row.provinceCode),
      membersCount,
      lastActivityAt: lastActivityIso,
      rawLastActivityAtType:
        row.lastActivityAt === null ? 'null' : typeof row.lastActivityAt,
    },
    issues,
    warnings,
  };
}

const PRIMARY_SQL = `
SELECT
  l.id                                         AS id,
  l.name                                       AS name,
  l.mode                                       AS mode,
  l.status                                     AS status,
  "myMember".role                              AS role,
  city.name                                    AS "cityName",
  province.code                                AS "provinceCode",
  (SELECT COUNT(1)
     FROM league_members lm
    WHERE lm."leagueId" = l.id)               AS "membersCount",
  (SELECT MAX(la."createdAt")
     FROM league_activity la
    WHERE la."leagueId" = l.id)               AS "lastActivityAt"
FROM leagues l
INNER JOIN league_members "myMember"
  ON "myMember"."leagueId" = l.id
 AND "myMember"."userId" = $1
LEFT JOIN users creator
  ON creator.id = l."creatorId"
LEFT JOIN cities city
  ON city.id = creator."cityId"
LEFT JOIN provinces province
  ON province.id = city."provinceId"
ORDER BY
  COALESCE(
    (SELECT MAX(la."createdAt") FROM league_activity la WHERE la."leagueId" = l.id),
    l."createdAt"
  ) DESC,
  l.id DESC
`;

const FALLBACK_SQL = `
SELECT
  l.id                                         AS id,
  l.name                                       AS name,
  l.mode                                       AS mode,
  l.status                                     AS status,
  "myMember".role                              AS role,
  city.name                                    AS "cityName",
  province.code                                AS "provinceCode",
  (SELECT COUNT(1)
     FROM league_members lm
    WHERE lm."leagueId" = l.id)               AS "membersCount",
  NULL                                         AS "lastActivityAt"
FROM leagues l
INNER JOIN league_members "myMember"
  ON "myMember"."leagueId" = l.id
 AND "myMember"."userId" = $1
LEFT JOIN users creator
  ON creator.id = l."creatorId"
LEFT JOIN cities city
  ON city.id = creator."cityId"
LEFT JOIN provinces province
  ON province.id = city."provinceId"
ORDER BY
  l."createdAt" DESC,
  l.id DESC
`;

const DUPLICATE_JOIN_SQL = `
SELECT
  l.id AS "leagueId",
  COUNT(1)::int AS "rowCount"
FROM leagues l
INNER JOIN league_members "myMember"
  ON "myMember"."leagueId" = l.id
 AND "myMember"."userId" = $1
LEFT JOIN users creator
  ON creator.id = l."creatorId"
LEFT JOIN cities city
  ON city.id = creator."cityId"
LEFT JOIN provinces province
  ON province.id = city."provinceId"
GROUP BY l.id
HAVING COUNT(1) > 1
ORDER BY "rowCount" DESC, "leagueId" DESC
`;

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
    let rows: RawLeagueRow[] = [];
    let usedFallback = false;

    try {
      rows = await ds.query(PRIMARY_SQL, [userId]);
    } catch (err) {
      if (!isMissingLeagueActivityRelation(err)) throw err;
      usedFallback = true;
      console.warn(
        `[diagnose] league_activity missing -> fallback query without lastActivityAt. reason="${getErrorMessage(err)}"`,
      );
      rows = await ds.query(FALLBACK_SQL, [userId]);
    }

    console.log(
      `[diagnose] userId=${userId} rows=${rows.length} fallback=${usedFallback}`,
    );
    if (rows.length === 0) {
      console.log('[diagnose] No leagues found for this user.');
    }

    const duplicates = await ds.query(DUPLICATE_JOIN_SQL, [userId]);
    if (duplicates.length > 0) {
      console.warn('[diagnose] Duplicate rows by join detected:');
      console.warn(safeJson(duplicates));
    } else {
      console.log('[diagnose] No join multiplication detected.');
    }

    const analyses = rows.map((row, index) => analyzeRow(row, index));
    const withIssues = analyses.filter((a) => a.issues.length > 0);
    const withWarnings = analyses.filter((a) => a.warnings.length > 0);

    console.log(
      `[diagnose] rowIssues=${withIssues.length} rowWarnings=${withWarnings.length}`,
    );
    for (const result of analyses) {
      if (result.issues.length === 0 && result.warnings.length === 0) continue;
      console.log(`\n--- Row ${result.index} ---`);
      console.log(safeJson(result.rowSample));
      if (result.issues.length > 0) {
        console.log('issues:');
        for (const issue of result.issues) console.log(`  - ${issue}`);
      }
      if (result.warnings.length > 0) {
        console.log('warnings:');
        for (const warning of result.warnings) console.log(`  - ${warning}`);
      }
    }

    if (withIssues.length === 0 && withWarnings.length === 0) {
      console.log('[diagnose] No anomalies detected.');
    }
  } catch (err) {
    console.error('[diagnose] Query failed:', getErrorMessage(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await ds.destroy();
    console.log('[diagnose] Done.');
  }
}

void main();
