import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RedisService } from '../redis/redis.service';
import { CACHE_KEY_METADATA, CACHE_TTL_METADATA } from '../decorators/cache.decorator';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);

  constructor(
    private reflector: Reflector,
    private redis: RedisService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const keyPrefix = this.reflector.get<string>(CACHE_KEY_METADATA, context.getHandler());
    const ttl = this.reflector.get<number>(CACHE_TTL_METADATA, context.getHandler());

    // If no cache metadata, skip caching
    if (!keyPrefix) {
      return next.handle();
    }

    // Build cache key from arguments
    const request = context.switchToHttp().getRequest();
    const args = context.getArgs();
    const cacheKey = this.buildCacheKey(keyPrefix, request, args);

    try {
      // Try to get from cache
      const cachedData = await this.redis.get(cacheKey);

      if (cachedData) {
        this.logger.debug(`Cache HIT: ${cacheKey}`);
        return of(JSON.parse(cachedData));
      }

      this.logger.debug(`Cache MISS: ${cacheKey}`);

      // Execute the method and cache the result
      return next.handle().pipe(
        tap(async (data) => {
          try {
            await this.redis.set(cacheKey, JSON.stringify(data), ttl);
            this.logger.debug(`Cached data for ${cacheKey} (TTL: ${ttl}s)`);
          } catch (err) {
            this.logger.error(`Failed to cache data for ${cacheKey}:`, err);
          }
        }),
      );
    } catch (error) {
      this.logger.error(`Cache error for ${cacheKey}:`, error);
      // On cache error, proceed without caching
      return next.handle();
    }
  }

  private buildCacheKey(prefix: string, request: any, args: any[]): string {
    // Extract useful parts from request
    const userId = request.user?.id || 'anonymous';
    const params = JSON.stringify(request.params || {});
    const query = JSON.stringify(request.query || {});

    // Create a deterministic key
    return `cache:${prefix}:${userId}:${params}:${query}`;
  }
}
