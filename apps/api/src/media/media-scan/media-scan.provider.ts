/**
 * Known-illegal-media scanning (hash matching against databases of known
 * child sexual abuse material, e.g. Thorn Safer, Microsoft PhotoDNA, the
 * IWF / NCMEC hash lists). See MediaScanService and docs/COMPLIANCE_CONTENT.md.
 */

export interface MediaScanRequest {
  /** SHA-256 of the file (hex) */
  sha256: string;
  /** MD5 of the file (hex): several hash lists are still keyed on MD5 */
  md5: string;
  mimeType: string;
  size: number;
  /** Raw bytes, only when the provider needs them (perceptual hashing) */
  bytes?: Buffer;
}

export interface MediaScanResponse {
  match: boolean;
  /** Provider's reference of the match (case id, list name...), kept as evidence */
  reference?: string | null;
}

export interface MediaScanProvider {
  readonly name: string;
  scan(request: MediaScanRequest): Promise<MediaScanResponse>;
}

/**
 * Default: no scanning. Media are marked SKIPPED and MediaScanService warns
 * in production that nothing is scanned.
 */
export class NoneMediaScanProvider implements MediaScanProvider {
  readonly name = 'none';

  async scan(): Promise<MediaScanResponse> {
    return { match: false };
  }
}

export interface HttpMediaScanOptions {
  name: string;
  apiUrl: string;
  apiKey?: string;
  /** Send the file bytes (base64) in addition to the hashes */
  sendBytes: boolean;
  timeoutMs: number;
}

/**
 * Generic HTTP hash-matching provider (MEDIA_SCAN_PROVIDER=http, or the
 * names of the services we are discussing with: thorn-safer, photodna).
 *
 * STUB: the request below is a placeholder contract:
 *   POST MEDIA_SCAN_API_URL
 *   Authorization: Bearer MEDIA_SCAN_API_KEY
 *   { sha256, md5, mimeType, size, data?: base64 }
 *   -> 200 { match: boolean, reference?: string }
 * Neither Thorn Safer nor PhotoDNA speaks this format as is (PhotoDNA
 * computes a perceptual hash from the image bytes, Safer has its own SDK /
 * API, both need a signed agreement and vetted access). The request/response
 * mapping MUST be adapted to the real API once the contract is signed.
 */
export class HttpMediaScanProvider implements MediaScanProvider {
  readonly name: string;

  constructor(private readonly options: HttpMediaScanOptions) {
    this.name = options.name;
  }

  async scan(request: MediaScanRequest): Promise<MediaScanResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(this.options.apiUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          sha256: request.sha256,
          md5: request.md5,
          mimeType: request.mimeType,
          size: request.size,
          ...(this.options.sendBytes && request.bytes ? { data: request.bytes.toString('base64') } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`Media scan provider answered HTTP ${response.status}`);
      }

      const body: any = await response.json();
      if (typeof body?.match !== 'boolean') {
        throw new Error('Media scan provider answer has no boolean "match"');
      }

      return { match: body.match, reference: body.reference ?? null };
    } finally {
      clearTimeout(timer);
    }
  }
}
