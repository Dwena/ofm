import { SetMetadata } from '@nestjs/common';

export const CACHE_KEY_METADATA = 'cache:key';
export const CACHE_TTL_METADATA = 'cache:ttl';

/**
 * Cache decorator for methods
 * @param keyPrefix - Prefix for the cache key
 * @param ttl - Time to live in seconds (default: 300 = 5 minutes)
 *
 * @example
 * @Cache('user:profile', 600)
 * async getUserProfile(userId: string) {
 *   // This result will be cached for 10 minutes
 * }
 */
export const Cache = (keyPrefix: string, ttl: number = 300) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(CACHE_KEY_METADATA, keyPrefix)(target, propertyKey, descriptor);
    SetMetadata(CACHE_TTL_METADATA, ttl)(target, propertyKey, descriptor);
  };
};
