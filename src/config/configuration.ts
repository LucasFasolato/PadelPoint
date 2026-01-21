import { validateEnv } from './env.schema';

export default () => {
  const env = validateEnv(process.env);

  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    DATABASE_URL: env.DATABASE_URL, 
    db: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASS,
      name: env.DB_NAME,
      // Note: env.DB_SYNC and DB_LOG are now booleans from the schema validation
      sync: env.DB_SYNC,
      log: env.DB_LOG,
    },
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    },
  };
};