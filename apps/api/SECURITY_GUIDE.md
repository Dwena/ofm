# Security Guide

This document describes all security features implemented in the OFM platform.

## 1. Rate Limiting

### Global Rate Limiting
Configured at application level:
```typescript
ThrottlerModule.forRoot([{
  ttl: 60000,    // 1 minute
  limit: 100,    // 100 requests per minute
}])
```

### Custom Throttle Decorators
```typescript
import { ThrottleStrict, ThrottleAuth, ThrottleUpload } from '@/common/decorators/throttle.decorator';

// Strict: 3 requests per minute
@ThrottleStrict()
@Post('sensitive-endpoint')
async sensitiveOperation() { ... }

// Auth: 5 login attempts per 5 minutes
@ThrottleAuth()
@Post('auth/login')
async login() { ... }

// Upload: 5 uploads per minute
@ThrottleUpload()
@Post('media/upload')
async upload() { ... }
```

### Redis-based Rate Limiting
The `ThrottlerGuard` uses Redis for distributed rate limiting:
- Tracks requests by IP and user ID
- Automatic cleanup with TTL
- Per-endpoint configuration
- Handles both authenticated and anonymous users

**Implementation**: `apps/api/src/common/guards/throttler.guard.ts`

### Recommended Limits by Endpoint Type

| Endpoint Type | Limit | Window | Decorator |
|--------------|-------|--------|-----------|
| Authentication | 5 | 5 min | `@ThrottleAuth()` |
| File Upload | 5 | 1 min | `@ThrottleUpload()` |
| Sensitive Operations | 3 | 1 min | `@ThrottleStrict()` |
| API Reads | 30 | 1 min | `@ThrottleLoose()` |
| API Writes | 10 | 1 min | `@ThrottleModerate()` |

## 2. CORS Configuration

### Production-Ready CORS
```typescript
app.enableCors({
  origin: (origin, callback) => {
    // Validate origin against whitelist in production
    if (nodeEnv === 'production') {
      if (corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // Allow all in development
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
  maxAge: 86400, // 24 hours
});
```

### Environment Configuration
```env
# Production
NODE_ENV=production
CORS_ORIGINS=https://app.yourdomain.com,https://www.yourdomain.com

# Development
NODE_ENV=development
CORS_ORIGINS=http://localhost:3000
```

### Security Features
- ✅ Origin validation in production
- ✅ Credentials support for cookies
- ✅ Preflight caching (24h)
- ✅ Explicit method whitelist
- ✅ Header whitelist

## 3. File Upload Validation

### Multi-Layer Validation

#### 1. Size Validation
```typescript
// Image: 10MB max
// Video: 500MB max (configurable)
// Audio: 50MB max

if (file.size > this.maxImageSize) {
  throw new BadRequestException('File too large');
}
```

#### 2. MIME Type Validation
```typescript
const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
];

if (!allowedMimeTypes.includes(file.mimetype)) {
  throw new BadRequestException('Invalid file type');
}
```

#### 3. File Extension Validation
```typescript
const ext = file.originalname.split('.').pop()?.toLowerCase();
if (!ext || !this.allowedImageFormats.includes(ext)) {
  throw new BadRequestException('Invalid file extension');
}
```

#### 4. Magic Bytes Validation (File Signature)
Prevents MIME type spoofing by checking actual file content:

```typescript
const signatures = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'video/mp4': [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]],
  'video/webm': [[0x1A, 0x45, 0xDF, 0xA3]],
};
```

**Security**: Prevents attackers from uploading malicious files with fake extensions.

#### 5. Filename Security
```typescript
// Check for path traversal
if (filename.includes('..') || filename.includes('/')) {
  throw new BadRequestException('Path traversal detected');
}

// Check for null bytes
if (filename.includes('\0')) {
  throw new BadRequestException('Null byte detected');
}

// Check for dangerous characters
const dangerousChars = /[<>:"|?*\x00-\x1f]/;
if (dangerousChars.test(filename)) {
  throw new BadRequestException('Dangerous characters');
}
```

#### 6. Total Upload Size
For multiple file uploads:
```typescript
validateTotalSize(files: Express.Multer.File[], maxTotalSize: number)
```

### Filename Sanitization
```typescript
sanitizeFilename(filename: string): string {
  // Remove path components
  filename = filename.split('/').pop()!.split('\\').pop()!;

  // Remove dangerous characters
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  return filename;
}
```

### Configuration
```env
# File size limits
MAX_FILE_SIZE_MB=500

# Allowed formats
ALLOWED_IMAGE_FORMATS=jpg,jpeg,png,gif,webp
ALLOWED_VIDEO_FORMATS=mp4,mov,avi,mkv,webm
ALLOWED_AUDIO_FORMATS=mp3,wav,aac,m4a
```

## 4. Watermarking

### Automatic Watermarking
Premium and PPV content is automatically watermarked:

```typescript
shouldWatermark(content: {
  isPpv?: boolean;
  tier?: { name: string };
  visibility?: string;
}): boolean {
  // Watermark PPV content
  if (content.isPpv) return true;

  // Watermark premium tier content
  if (['PREMIUM', 'VIP'].includes(content.tier?.name)) return true;

  // Watermark subscribers-only content
  return content.visibility === 'SUBSCRIBERS_ONLY';
}
```

### Image Watermarking
Using Sharp library:

```typescript
// Text watermark
const watermarked = await watermarkService.watermarkImage(imageBuffer, {
  text: 'OFM Premium',
  position: 'bottom-right',
  opacity: 0.5,
  fontSize: 32,
  color: 'white'
});

// Logo watermark
const watermarked = await watermarkService.watermarkImageWithLogo(
  imageBuffer,
  './assets/logo.png',
  { position: 'bottom-right', opacity: 0.7 }
);
```

### Video Watermarking
Using FFmpeg:

```typescript
// Text watermark
await watermarkService.watermarkVideo(
  inputPath,
  outputPath,
  {
    text: 'OFM Premium',
    position: 'bottom-right',
    opacity: 0.5,
    fontSize: 24
  }
);

// Logo watermark
await watermarkService.watermarkVideoWithLogo(
  inputPath,
  outputPath,
  logoPath,
  { position: 'bottom-right', opacity: 0.7 }
);
```

### Watermark Positions
- `top-left`
- `top-right`
- `bottom-left`
- `bottom-right` (default)
- `center`

### Configuration
```env
# Watermark settings
WATERMARK_TEXT="Your Brand"
WATERMARK_LOGO_PATH=./assets/watermark-logo.png
```

## 5. Additional Security Measures

### Helmet.js
Content Security Policy and other security headers:
```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
```

### Body Parser Limits
Prevents DoS attacks via large payloads:
```typescript
app.useBodyParser('json', { limit: '10mb' });
app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });
```

### Input Validation
Class-validator with strict rules:
```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,              // Strip non-whitelisted properties
    forbidNonWhitelisted: true,   // Throw error on extra properties
    transform: true,              // Auto-transform to DTO types
  })
);
```

### Trust Proxy
For accurate IP detection behind proxies:
```typescript
app.set('trust proxy', 1);
```

### Compression
Reduces bandwidth and improves performance:
```typescript
app.use(compression());
```

## 6. Authentication Security

### JWT with Short Expiry
```typescript
{
  expiresIn: '15m',  // Access token
  expiresIn: '7d',   // Refresh token
}
```

### Password Hashing
Using bcryptjs with 10 rounds:
```typescript
const hashedPassword = await bcrypt.hash(password, 10);
```

### 2FA Support
Time-based OTP for enhanced security.

### Token Blacklisting
Revoked tokens stored in Redis:
```typescript
await this.redis.set(`blacklist:${token}`, '1', ttl);
```

## 7. Database Security

### Parameterized Queries
Prisma automatically prevents SQL injection.

### Soft Deletes
Critical data uses soft deletes:
```typescript
deletedAt: DateTime?
```

### Row-Level Security
Implemented in service layer:
```typescript
if (content.creatorId !== userId) {
  throw new ForbiddenException('Access denied');
}
```

## 8. Monitoring & Logging

### Request Logging
All requests logged with metadata:
```typescript
app.useGlobalInterceptors(new LoggingInterceptor());
```

### Error Tracking
Sentry integration for production:
```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

### Rate Limit Logging
Failed rate limit attempts logged:
```typescript
this.logger.warn(`Rate limit exceeded for ${ip}`);
```

## 9. API Best Practices

### DO:
✅ Use HTTPS in production
✅ Implement rate limiting on all endpoints
✅ Validate all user inputs
✅ Check file signatures, not just extensions
✅ Sanitize filenames
✅ Use strong passwords (min 8 chars, mixed case, numbers, symbols)
✅ Enable 2FA for sensitive accounts
✅ Rotate JWT secrets regularly
✅ Keep dependencies updated
✅ Use environment variables for secrets

### DON'T:
❌ Trust client-side validation only
❌ Store passwords in plain text
❌ Use predictable file names
❌ Allow unlimited file uploads
❌ Disable CORS in production
❌ Expose stack traces to users
❌ Use default credentials
❌ Commit secrets to git
❌ Allow SQL injection (use ORM)
❌ Skip authentication checks

## 10. Security Checklist

### Development
- [ ] All secrets in `.env` files
- [ ] `.env` files in `.gitignore`
- [ ] Input validation on all DTOs
- [ ] Rate limiting on sensitive endpoints
- [ ] File upload validation implemented
- [ ] CORS configured for development URLs

### Production
- [ ] HTTPS enforced
- [ ] CORS restricted to production domains
- [ ] Rate limiting enabled globally
- [ ] Helmet.js configured
- [ ] JWT secrets rotated
- [ ] Database credentials secured
- [ ] S3/Storage credentials secured
- [ ] Sentry monitoring enabled
- [ ] Backups configured
- [ ] Firewall rules applied
- [ ] DDoS protection enabled
- [ ] CDN configured
- [ ] Security headers validated
- [ ] Penetration testing completed

## 11. Incident Response

### If Security Breach Detected:
1. **Immediate**: Disable affected endpoints
2. **5 minutes**: Notify development team
3. **15 minutes**: Review logs for extent of breach
4. **30 minutes**: Patch vulnerability
5. **1 hour**: Reset affected credentials
6. **24 hours**: Full security audit
7. **48 hours**: Incident report and lessons learned

### Emergency Contacts
- Security Team: security@yourdomain.com
- DevOps: devops@yourdomain.com
- CTO: cto@yourdomain.com

## 12. Compliance

### GDPR
- User data deletion implemented
- Data export available
- Consent tracking
- Privacy policy linked

### PCI DSS
- Payment data handled by Stripe (PCI compliant)
- No credit card data stored locally

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NestJS Security](https://docs.nestjs.com/security/helmet)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
