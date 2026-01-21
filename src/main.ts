import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  console.log('JWT_SECRET=', process.env.JWT_SECRET);
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true, // This allows all origins (easiest for dev)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
