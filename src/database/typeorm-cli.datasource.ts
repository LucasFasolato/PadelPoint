import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { validateEnv } from '../config/env.schema';

const env = validateEnv(process.env) as unknown as {
  DATABASE_URL: string;
  DB_LOG: string;
  NODE_ENV: string;
};

export default new DataSource({
  type: 'postgres',
  // Railway provides the full connection string here
  url: env.DATABASE_URL,

  synchronize: false,
  logging: env.DB_LOG === 'true',

  // Robust path handling for both Dev (ts) and Prod (js)
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],

  // Recommended for Railway/Cloud connections
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
