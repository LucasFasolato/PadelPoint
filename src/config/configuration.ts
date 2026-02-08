import { validateEnv } from './env.schema';

export default () => {
  const env = validateEnv(process.env);

  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    enableCrons: env.ENABLE_CRONS,
    databaseUrl: env.DATABASE_URL,
    db: {
      sync: env.DB_SYNC,
      log: env.DB_LOG,
    },
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    },
    cloudinary: {
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
    },
    media: {
      allowedFormats: env.MEDIA_ALLOWED_FORMATS,
      maxBytes: env.MEDIA_MAX_BYTES,
    },
    mercadoPago: {
      accessToken: env.MP_ACCESS_TOKEN,
      currency: env.MP_CURRENCY,
    },
    email: {
      resendApiKey: env.RESEND_API_KEY ?? null,
      from: env.EMAIL_FROM,
      appUrl: env.APP_URL,
      enabled: env.EMAIL_ENABLED,
      logOnly: env.EMAIL_LOG_ONLY,
    },
  };
};
