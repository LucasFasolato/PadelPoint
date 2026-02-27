/*
 * STAGING baseline bootstrap for Railway-like environments where schema exists
 * but "migrations" table is empty.
 *
 * Runs only when:
 * - NODE_ENV=staging
 * - MIGRATIONS_BASELINE=true
 *
 * Safe behavior:
 * - Never drops/deletes schema objects
 * - If migrations table already has rows, it exits without changes
 * - Inserts migration history rows idempotently (ON CONFLICT DO NOTHING)
 */

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function logGeoCounts(query: (sql: string) => Promise<unknown[]>) {
  try {
    const rows = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM "countries") AS "countries",
         (SELECT COUNT(*)::int FROM "provinces") AS "provinces"`,
    );
    if (!Array.isArray(rows) || rows.length === 0) return;
    const firstRow = rows[0];
    if (typeof firstRow !== 'object' || firstRow === null) return;
    const row = firstRow as Record<string, unknown>;
    const countries = Number(row.countries ?? 0);
    const provinces = Number(row.provinces ?? 0);
    console.log(
      `[baseline] geo counts -> countries=${countries}, provinces=${provinces}`,
    );
  } catch {
    console.log(
      '[baseline] geo counts skipped (countries/provinces not available)',
    );
  }
}

async function readMigrationsCount(
  query: (sql: string) => Promise<unknown[]>,
  table: string,
): Promise<number> {
  const rows = await query(`SELECT COUNT(*)::int AS "count" FROM ${table}`);
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const firstRow = rows[0];
  if (typeof firstRow !== 'object' || firstRow === null) return 0;
  const row = firstRow as Record<string, unknown>;
  return Number(row.count ?? 0);
}

async function main() {
  const baselineEnabled = parseBoolean(process.env.MIGRATIONS_BASELINE, false);
  const nodeEnv = (process.env.NODE_ENV ?? '').trim().toLowerCase();

  if (!baselineEnabled) {
    console.log(
      '[baseline] skipped: MIGRATIONS_BASELINE is not enabled (set MIGRATIONS_BASELINE=true to enable)',
    );
    return;
  }

  if (nodeEnv !== 'staging') {
    console.log(
      `[baseline] skipped: NODE_ENV=${process.env.NODE_ENV ?? '(unset)'} (only NODE_ENV=staging is allowed)`,
    );
    return;
  }

  const module = await import('../database/typeorm.datasource');
  const dataSource = module.default;

  await dataSource.initialize();
  try {
    const options = dataSource.options as { migrationsTableName?: string };
    const migrationsTableName = options.migrationsTableName ?? 'migrations';
    const table = quoteIdentifier(migrationsTableName);

    await dataSource.query(
      `CREATE TABLE IF NOT EXISTS ${table} (
         "id" SERIAL PRIMARY KEY,
         "timestamp" bigint NOT NULL,
         "name" character varying NOT NULL
       )`,
    );

    await dataSource.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_migrations_timestamp_name_unique"
       ON ${table} ("timestamp", "name")`,
    );

    const currentCount = await readMigrationsCount(
      (sql) => dataSource.query(sql),
      table,
    );

    if (currentCount > 0) {
      console.log(
        `[baseline] skipped: ${migrationsTableName} already has ${currentCount} row(s)`,
      );
      await logGeoCounts((sql) => dataSource.query(sql));
      return;
    }

    const migrations = dataSource.migrations
      .map((migration) => {
        const name = typeof migration.name === 'string' ? migration.name : '';
        const timestampMatch = name.match(/(\d{13,})$/);
        return {
          timestamp: timestampMatch ? Number(timestampMatch[1]) : Number.NaN,
          name,
        };
      })
      .filter(
        (migration) =>
          Number.isFinite(migration.timestamp) &&
          typeof migration.name === 'string' &&
          migration.name.length > 0,
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    if (migrations.length === 0) {
      console.log(
        '[baseline] no migrations found in DataSource; nothing inserted',
      );
      await logGeoCounts((sql) => dataSource.query(sql));
      return;
    }

    let inserted = 0;
    for (const migration of migrations) {
      await dataSource.query(
        `INSERT INTO ${table} ("timestamp", "name")
         VALUES ($1, $2)
         ON CONFLICT ("timestamp", "name") DO NOTHING`,
        [migration.timestamp, migration.name],
      );
      inserted += 1;
    }

    const afterCount = await readMigrationsCount(
      (sql) => dataSource.query(sql),
      table,
    );

    console.log(
      `[baseline] inserted ${inserted} migration baseline row(s); table now has ${afterCount}`,
    );
    await logGeoCounts((sql) => dataSource.query(sql));
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error('[baseline] failed:', error);
  process.exit(1);
});
