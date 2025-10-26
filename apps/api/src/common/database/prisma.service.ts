import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'pretty',
    });

    // Log queries in development
    // Note: These type assertions are needed until Prisma client is regenerated
    if (process.env.NODE_ENV === 'development') {
      // @ts-expect-error - Prisma client needs regeneration after schema changes
      this.$on('query', (e: any) => {
        this.logger.debug(`Query: ${e.query}`);
        this.logger.debug(`Duration: ${e.duration}ms`);
      });
    }

    // @ts-expect-error - Prisma client needs regeneration after schema changes
    this.$on('error', (e: any) => {
      this.logger.error(`Error: ${e.message}`);
    });

    // @ts-expect-error - Prisma client needs regeneration after schema changes
    this.$on('warn', (e: any) => {
      this.logger.warn(`Warning: ${e.message}`);
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected successfully');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production!');
    }

    const models = Reflect.ownKeys(this).filter((key) => {
      if (typeof key === 'string') {
        return key[0] !== '_' && key[0] === key[0].toLowerCase();
      }
      return false;
    });

    return Promise.all(
      models.map((modelKey) => {
        return (this as any)[modelKey].deleteMany();
      }),
    );
  }
}
