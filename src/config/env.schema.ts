import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().pipe(z.int().positive()).default(3000),

  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().pipe(z.int().positive()),
  DB_USER: z.string().min(1),
  DB_PASS: z.string().min(1),
  DB_NAME: z.string().min(1),

  DB_SYNC: z.enum(['true', 'false']).default('false'),
  DB_LOG: z.enum(['true', 'false']).default('false'),

  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
});

export type EnvVars = z.infer<typeof envSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv): EnvVars {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(
      '❌ Invalid environment variables:',
      parsed.error.flatten().fieldErrors,
    );
    throw new Error('Invalid environment variables');
  }
  return parsed.data;
}
