import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates the Bearer token when there is a valid one, but lets
 * anonymous visitors (no token, or an invalid one) through with no user
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // Anonymous visitor
    }
    return true;
  }

  handleRequest(_err: any, user: any) {
    return user || null;
  }
}
