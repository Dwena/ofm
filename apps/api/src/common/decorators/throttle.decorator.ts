import { SetMetadata } from '@nestjs/common';

export const THROTTLE_LIMIT_KEY = 'throttle:limit';
export const THROTTLE_TTL_KEY = 'throttle:ttl';

/**
 * Custom throttle decorator with configurable limits
 * @param limit - Maximum number of requests
 * @param ttl - Time window in seconds
 *
 * @example
 * @Throttle(5, 60) // 5 requests per minute
 * async sensitiveEndpoint() { ... }
 */
export const Throttle = (limit: number, ttl: number = 60) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    SetMetadata(THROTTLE_LIMIT_KEY, limit)(target, propertyKey, descriptor);
    SetMetadata(THROTTLE_TTL_KEY, ttl)(target, propertyKey, descriptor);
  };
};

/**
 * Preset throttle decorators for common use cases
 */
export const ThrottleStrict = () => Throttle(3, 60); // 3 requests per minute
export const ThrottleModerate = () => Throttle(10, 60); // 10 requests per minute
export const ThrottleLoose = () => Throttle(30, 60); // 30 requests per minute
export const ThrottleAuth = () => Throttle(5, 300); // 5 login attempts per 5 minutes
export const ThrottleUpload = () => Throttle(5, 60); // 5 uploads per minute
