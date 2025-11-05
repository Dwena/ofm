import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import * as Sentry from '@sentry/node';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  // Sentry
  const sentryDsn = configService.get('SENTRY_DSN');
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: configService.get('NODE_ENV'),
      tracesSampleRate: 1.0,
    });
  }

  // API Prefix
  const apiPrefix = configService.get('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // Versioning disabled - we use prefix for versioning instead
  // app.enableVersioning({
  //   type: VersioningType.URI,
  //   defaultVersion: '1',
  // });

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // Compression
  app.use(compression());

  // CORS - Production-ready configuration
  const nodeEnv = configService.get('NODE_ENV');
  const corsOrigins = configService
    .get('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((origin: string) => origin.trim());

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // In production, strictly validate origins
      if (nodeEnv === 'production') {
        if (corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      } else {
        // In development, allow all origins
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-CSRF-Token',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page', 'X-RateLimit-Remaining'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(
    new TransformInterceptor(),
    new LoggingInterceptor(),
  );

  // Trust proxy
  app.set('trust proxy', 1);

  // Body parser limits
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });

  // Swagger API Documentation
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('OFM Platform API')
      .setDescription('OnlyFans Management Platform - Complete API Documentation')
      .setVersion('1.0')
      .addTag('auth', 'Authentication endpoints')
      .addTag('users', 'User management')
      .addTag('content', 'Content management')
      .addTag('stories', 'Ephemeral stories (24h)')
      .addTag('streaming', 'Live streaming')
      .addTag('subscriptions', 'Subscription management')
      .addTag('payments', 'Payment & billing')
      .addTag('messaging', 'Direct messaging')
      .addTag('notifications', 'Notifications')
      .addTag('analytics', 'Analytics & stats')
      .addTag('media', 'Media upload & processing')
      .addTag('moderation', 'Content moderation')
      .addTag('admin', 'Admin operations')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token',
          name: 'JWT',
          in: 'header',
        },
        'JWT-auth',
      )
      .addServer(`http://localhost:${port}`, 'Development')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
      },
      customSiteTitle: 'OFM API Documentation',
      customCss: '.swagger-ui .topbar { display: none }',
    });

    console.log(`   📚 Swagger Docs: http://localhost:${port}/api/docs`);
  }

  // Start server
  const port = configService.get('PORT', 3001);
  await app.listen(port);

  console.log(`
    ╔═══════════════════════════════════════════════════════════════╗
    ║                                                               ║
    ║   🚀 OFM API Server is running                                ║
    ║                                                               ║
    ║   Environment: ${configService.get('NODE_ENV')?.padEnd(40)}  ║
    ║   URL: http://localhost:${port}${' '.repeat(35)}  ║
    ║   API: http://localhost:${port}/${apiPrefix}${' '.repeat(Math.max(0, 24 - apiPrefix.length))}  ║${nodeEnv !== 'production' ? `
    ║   📚 Docs: http://localhost:${port}/api/docs${' '.repeat(26)}  ║` : ''}
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
  `);
}

bootstrap();
