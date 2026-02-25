import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createOpenApiDocument } from './openapi';

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortJson((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

async function main() {
  process.env.OPENAPI_SNAPSHOT_MODE = '1';
  process.env.NODE_ENV ??= 'test';
  process.env.ENABLE_CRONS ??= 'false';
  process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/padelpoint';
  process.env.JWT_SECRET ??= 'openapi-snapshot-secret';
  process.env.CLOUDINARY_CLOUD_NAME ??= 'openapi-snapshot';
  process.env.CLOUDINARY_API_KEY ??= 'openapi-snapshot';
  process.env.CLOUDINARY_API_SECRET ??= 'openapi-snapshot';
  process.env.MP_ACCESS_TOKEN ??= 'openapi-snapshot';
  process.env.EMAIL_ENABLED ??= 'false';
  process.env.EMAIL_LOG_ONLY ??= 'true';

  const { AppModule } = await import('@/app.module');

  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await app.init();
    const document = createOpenApiDocument(app);
    const outputPath = resolve(process.cwd(), 'openapi.snapshot.json');
    const stableDoc = sortJson(document);
    writeFileSync(outputPath, `${JSON.stringify(stableDoc, null, 2)}\n`, 'utf8');
    process.stdout.write(`Wrote ${outputPath}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
