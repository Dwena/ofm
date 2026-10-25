import { Request } from 'express';
import { normalizeCountry } from '../common/utils/vat';
import type { PaymentRequestContext } from './payments.service';

/**
 * Country of the client IP set by the CDN (Cloudflare / CloudFront), kept as
 * a VAT location evidence, and the client IP
 */
export function paymentContext(request: Request): PaymentRequestContext {
  const header = request.headers['cf-ipcountry'] ?? request.headers['cloudfront-viewer-country'];
  return {
    ipCountry: normalizeCountry(Array.isArray(header) ? header[0] : header),
    clientIp: request.ip ?? null,
  };
}
