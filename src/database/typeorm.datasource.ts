import { join } from 'path';
import { DataSource } from 'typeorm';

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function shouldUseSsl(): boolean {
  if (parseBoolean(process.env.DATABASE_SSL)) return true;
  if (parseBoolean(process.env.DB_SSL)) return true;

  const sslMode = (process.env.PGSSLMODE ?? '').trim().toLowerCase();
  if (['require', 'verify-ca', 'verify-full'].includes(sslMode)) return true;

  return false;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl.trim().length === 0) {
  throw new Error('DATABASE_URL is required');
}

const sslEnabled = shouldUseSsl();
const rejectUnauthorized = parseBoolean(
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED,
  false,
);

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  logging: parseBoolean(process.env.DB_LOG, false),
  entities: [join(__dirname, '..', '**', '*.entity.{js,ts}')],
  migrations: [join(__dirname, '..', 'migrations', '*.{js,ts}')],
  ssl: sslEnabled ? { rejectUnauthorized } : false,
});
