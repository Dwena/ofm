import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard as NestThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ThrottlerGuard extends NestThrottlerGuard {
  constructor(
    private redis: RedisService,
  ) {
    super();
  }

  async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = this.generateKey(context, request);

    // Get current count from Redis
    const current = await this.redis.get(key);
    const count = current ? parseInt(current) : 0;

    if (count >= limit) {
      throw new ThrottlerException('Too Many Requests');
    }

    // Increment counter
    await this.redis.incr(key);

    // Set expiry if it's the first request
    if (count === 0) {
      await this.redis.expire(key, ttl);
    }

    return true;
  }

  protected generateKey(context: ExecutionContext, request: any): string {
    const handler = context.getHandler().name;
    const className = context.getClass().name;

    // Use IP address as identifier
    const ip = request.ip || request.connection.remoteAddress;

    // Use user ID if authenticated
    const userId = request.user?.id || 'anonymous';

    return `throttle:${className}:${handler}:${userId}:${ip}`;
  }
}
