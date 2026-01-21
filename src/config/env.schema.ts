import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.preprocess((val) => Number(val), z.number()).default(3000),
  
  // ✅ Add this as required for Railway
  DATABASE_URL: z.string().url(),

  // ⚠️ Make these optional (.optional()) so they don't crash the app in production
  DB_HOST: z.string().optional(),
  DB_PORT: z.preprocess((val) => Number(val), z.number()).optional(),
  DB_USER: z.string().optional(),
  DB_PASS: z.string().optional(),
  DB_NAME: z.string().optional(),

  DB_SYNC: z.preprocess((val) => val === 'true', z.boolean()).default(false),
  DB_LOG: z.preprocess((val) => val === 'true', z.boolean()).default(false),
  
  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('7d'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, any>) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }

  return result.data;
}