import { validateEnv } from './env.schema';

export default () => {
  const env = validateEnv(process.env);

  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    db: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASS,
      name: env.DB_NAME,
      sync: env.DB_SYNC === 'true',
      log: env.DB_LOG === 'true',
    },
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    },
  };
};
