import { createParamDecorator, ExecutionContext, Injectable, PipeTransform } from '@nestjs/common';
import { AgeVerificationService } from '../age-verification.service';

const RequestForAgeVerification = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest(),
);

/**
 * Resolves the request into "is the requester's age verified" (see
 * AgeVerificationService.isAgeVerified)
 */
@Injectable()
export class AgeVerifiedPipe implements PipeTransform {
  constructor(private readonly ageVerification: AgeVerificationService) {}

  transform(request: any): Promise<boolean> {
    return this.ageVerification.isAgeVerified(request);
  }
}

/**
 * Handler parameter: `true` when the requester may see explicit media
 * (staff, logged-in user with a valid User.ageVerifiedAt, or a valid
 * X-Age-Verification token). Use it with the helpers of age-gate.ts:
 *
 *   @Get('feed')
 *   async getFeed(@CurrentUser('id') userId: string, @AgeVerified() ageVerified: boolean) {
 *     return gateContentItems(await this.service.getFeed(userId), { viewerId: userId, ageVerified });
 *   }
 */
export const AgeVerified = () => RequestForAgeVerification(undefined, AgeVerifiedPipe);
