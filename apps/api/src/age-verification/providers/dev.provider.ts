import { Logger } from '@nestjs/common';
import {
  AgeVerificationProvider,
  CompleteVerificationResult,
  StartVerificationParams,
} from './age-verification-provider.interface';

/**
 * Development simulator of a third-party age verification: sends the visitor
 * to the web page /verification-age/dev, which offers "Je suis majeur(e)" /
 * "Je suis mineur(e)" and calls the API callback back with the answer.
 *
 * It is a self-declaration, which the law does NOT accept: it refuses to run
 * when NODE_ENV=production.
 */
export class DevAgeVerificationProvider implements AgeVerificationProvider {
  readonly name = 'dev';
  private readonly logger = new Logger(DevAgeVerificationProvider.name);

  constructor(
    private readonly webUrl: string,
    private readonly isProduction: boolean,
  ) {
    if (isProduction) {
      this.logger.error(
        'The "dev" age verification provider is disabled in production: set AGE_VERIFICATION_PROVIDER=oidc',
      );
    }
  }

  private assertNotProduction() {
    if (this.isProduction) {
      throw new Error('The dev age verification provider cannot be used in production');
    }
  }

  async startVerification({ state, nonce }: StartVerificationParams) {
    this.assertNotProduction();
    const params = new URLSearchParams({ state, nonce });
    return { redirectUrl: `${this.webUrl}/verification-age/dev?${params.toString()}` };
  }

  async completeVerification(
    params: Record<string, unknown>,
    expected: { state: string; nonce: string },
  ): Promise<CompleteVerificationResult> {
    this.assertNotProduction();
    const method = 'dev-simulator';

    if (params.state !== expected.state || params.nonce !== expected.nonce) {
      return { verified: false, method, reason: 'INVALID_RESPONSE' };
    }
    if (params.result !== 'adult') {
      return { verified: false, method, reason: 'UNDERAGE' };
    }
    return { verified: true, method };
  }
}
