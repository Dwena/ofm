import { SetMetadata } from '@nestjs/common';

// Define UserRole type manually until Prisma client is regenerated
export type UserRole = 'CREATOR' | 'SUBSCRIBER' | 'ADMIN' | 'MODERATOR';

export const UserRole = {
  CREATOR: 'CREATOR' as UserRole,
  SUBSCRIBER: 'SUBSCRIBER' as UserRole,
  ADMIN: 'ADMIN' as UserRole,
  MODERATOR: 'MODERATOR' as UserRole,
};

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
