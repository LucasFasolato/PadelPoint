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
  REDIS_URL: z.string().url().optional(),

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
  RESEND_FROM_EMAIL: z.string().optional(),
  EMAIL_FROM: z.string().default('PadelPoint <noreply@padelpoint.app>'),
  APP_URL: z.string().default('http://localhost:3000'),
  APP_PUBLIC_URL: z.string().url().optional(),
  EMAIL_ENABLED: z
    .preprocess((val) => val !== 'false', z.boolean())
    .default(true),
  EMAIL_LOG_ONLY: z
    .preprocess((val) => val === 'true', z.boolean())
    .default(false),

  // Disputes
  DISPUTE_WINDOW_HOURS: z
    .preprocess((val) => Number(val), z.number())
    .default(48),

  // Rankings
  RANKING_MIN_MATCHES: z
    .preprocess((val) => Number(val), z.number().int().min(1))
    .default(4),
  SLOW_QUERY_MS: z
    .preprocess((val) => Number(val), z.number().int().positive())
    .default(500),
  SLOW_REQUEST_MS: z
    .preprocess((val) => Number(val), z.number().int().positive())
    .default(1500),

  // Application environment (for multi-env routing)
  APP_ENV: z.enum(['staging', 'production']).default('staging'),

  // Frontend URLs
  FRONT_STAGING_URL: z
    .string()
    .url()
    .default('https://staging-padel-point-front.vercel.app'),
  FRONT_PROD_URL: z
    .string()
    .url()
    .default('https://padel-point-front.vercel.app'),

  // Google OAuth (optional — routes gracefully fail if unset)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),
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
