import 'dotenv/config'; // Carga .env local si existe
import { DataSource } from 'typeorm';
import { join } from 'path';
import { validateEnv } from '../config/env.schema'; // Asegúrate que la ruta sea correcta

// Validamos las variables antes de crear la conexión
const env = validateEnv(process.env);

// Lógica de SSL para CLI (igual que en el módulo)
const isProduction = env.NODE_ENV === 'production';
const dbUrl = env.DATABASE_URL;
const sslEnabled =
  isProduction || dbUrl.includes('rlwy.net') || dbUrl.includes('railway');

export default new DataSource({
  type: 'postgres',
  url: dbUrl,

  // ⚠️ IMPORTANTE: En migraciones 'synchronize' SIEMPRE debe ser false
  // Las tablas se alteran mediante los archivos de migración, no automáticamente.
  synchronize: false,
  logging: env.DB_LOG === true, // validateEnv ya lo convirtió a boolean

  // Path robusto compatible con TypeScript (src) y JavaScript (dist)
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],

  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
});
