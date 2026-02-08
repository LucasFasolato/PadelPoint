import { z } from 'zod';

export const envSchema = z.object({
  // Core
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.preprocess((val) => Number(val), z.number()).default(3000),
  ENABLE_CRONS: z
    .preprocess((val) => val === 'true', z.boolean())
    .default(true),

  // Database
  DATABASE_URL: z.string().url(),
  DB_SYNC: z.preprocess((val) => val === 'true', z.boolean()).default(false),
  DB_LOG: z.preprocess((val) => val === 'true', z.boolean()).default(false),

  // Auth
  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: z.string(),
  CLOUDINARY_API_KEY: z.string(),
  CLOUDINARY_API_SECRET: z.string(),

  // Media
  MEDIA_ALLOWED_FORMATS: z.string().default('jpg,jpeg,png,webp'),
  MEDIA_MAX_BYTES: z
    .preprocess((val) => Number(val), z.number())
    .default(5000000),

  // MercadoPago
  MP_ACCESS_TOKEN: z.string(),
  MP_CURRENCY: z.string().default('ARS'),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('PadelPoint <noreply@padelpoint.app>'),
  APP_URL: z.string().default('http://localhost:3000'),
  EMAIL_ENABLED: z
    .preprocess((val) => val !== 'false', z.boolean())
    .default(true),
  EMAIL_LOG_ONLY: z
    .preprocess((val) => val === 'true', z.boolean())
    .default(false),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, any>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    console.error(
      '❌ Invalid environment variables:',
      result.error.flatten().fieldErrors,
    );
    throw new Error('Invalid environment variables');
  }
  return result.data;
}
