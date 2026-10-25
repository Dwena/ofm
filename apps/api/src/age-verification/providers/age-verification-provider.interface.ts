/**
 * Third-party age verification solution.
 *
 * Double anonymity (Arcom référentiel): the provider must never tell the
 * platform who the visitor is, only whether they are 18 or older, and the
 * provider must not learn which site the visitor comes from beyond what the
 * protocol requires. The platform keeps only the outcome (verified or not,
 * when, method): implementations must never return or log identity data.
 */
export interface StartVerificationParams {
  /** Random value bound to the attempt, sent back by the provider */
  state: string;
  /** Random value the provider must embed in its signed answer (replay protection) */
  nonce: string;
  /** API endpoint the provider sends the visitor back to */
  callbackUrl: string;
}

export interface CompleteVerificationResult {
  verified: boolean;
  /** Short label stored with the outcome (never identity data), e.g. "oidc:verifier.example" */
  method: string;
  /** Machine-readable reason when not verified (logs / web message) */
  reason?: string;
}

export interface AgeVerificationProvider {
  readonly name: string;

  startVerification(params: StartVerificationParams): Promise<{ redirectUrl: string }>;

  /**
   * Check the provider's answer (query string or form body of the callback)
   * for the attempt identified by `expected.state`.
   */
  completeVerification(
    params: Record<string, unknown>,
    expected: { state: string; nonce: string; callbackUrl: string },
  ): Promise<CompleteVerificationResult>;
}

export const AGE_VERIFICATION_PROVIDER = Symbol('AGE_VERIFICATION_PROVIDER');
