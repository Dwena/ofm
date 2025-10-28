# CDN Configuration Guide for OFM Platform

This document describes how to configure a Content Delivery Network (CDN) for optimal media delivery performance.

## Overview

The OFM platform serves media files (images, videos) through S3/MinIO storage. To optimize performance globally, we recommend using a CDN service.

## Supported CDN Providers

### 1. CloudFront (AWS)

**Setup Steps:**
1. Create a CloudFront distribution
2. Set origin to your S3 bucket or MinIO endpoint
3. Configure origin access identity (OAI) for S3
4. Update environment variables:
   ```env
   CDN_URL=https://d123abc.cloudfront.net
   CDN_ENABLED=true
   ```

**Recommended Settings:**
- **Viewer Protocol Policy**: Redirect HTTP to HTTPS
- **Allowed HTTP Methods**: GET, HEAD, OPTIONS
- **Cached HTTP Methods**: GET, HEAD, OPTIONS
- **Cache TTL**:
  - Minimum: 0
  - Maximum: 31536000 (1 year)
  - Default: 86400 (1 day)
- **Compress Objects Automatically**: Yes
- **Price Class**: Use all edge locations (for best performance)

**Cache Key Settings:**
```
Include Query Strings: Yes (for image transformations)
Query String Whitelist: w, h, q, f (width, height, quality, format)
```

### 2. Cloudflare

**Setup Steps:**
1. Add your domain to Cloudflare
2. Create a CNAME record pointing to storage endpoint
3. Update environment variables:
   ```env
   CDN_URL=https://cdn.yourdomain.com
   CDN_ENABLED=true
   ```

**Recommended Settings:**
- **Caching Level**: Standard
- **Browser Cache TTL**: 1 year
- **Edge Cache TTL**: 1 month
- **Always Online**: Yes
- **Polish**: Lossless (for images)
- **Mirage**: On (for image optimization)

**Page Rules:**
```
Pattern: cdn.yourdomain.com/ofm-content-*/*
Settings:
  - Cache Level: Cache Everything
  - Edge Cache TTL: 1 month
  - Browser Cache TTL: 1 year
```

### 3. BunnyCDN

**Setup Steps:**
1. Create a Pull Zone
2. Set origin URL to your storage endpoint
3. Update environment variables:
   ```env
   CDN_URL=https://yourzone.b-cdn.net
   CDN_ENABLED=true
   ```

**Recommended Settings:**
- **Cache Expiration**: 24 hours
- **Query String Caching**: Enabled
- **Vary Cache**: Disabled
- **Optimizer**: Enabled (for images)
- **WebP**: Enabled

## Environment Variables

Add these to your `.env` file:

```env
# CDN Configuration
CDN_ENABLED=true
CDN_URL=https://your-cdn-domain.com
CDN_PROVIDER=cloudfront  # or cloudflare, bunnycdn

# Cache Headers (already configured in code)
CACHE_MAX_AGE=31536000  # 1 year in seconds
```

## Cache Headers Configuration

The application automatically sets the following cache headers:

### For Static Media Files (images, videos):
```
Cache-Control: public, max-age=31536000, immutable
```

This means:
- **public**: Can be cached by CDNs and browsers
- **max-age=31536000**: Cache for 1 year
- **immutable**: Content will never change (versioned URLs)

### For Dynamic Content (API responses):
```
Cache-Control: no-cache, no-store, must-revalidate
```

## URL Structure

### Without CDN:
```
https://s3.amazonaws.com/ofm-content/uploads/abc123.jpg
```

### With CDN:
```
https://cdn.yourdomain.com/ofm-content/uploads/abc123.jpg
```

## Image Optimization

The platform supports query parameters for on-the-fly image optimization:

```
?w=800          # Width: 800px
?h=600          # Height: 600px
?q=85           # Quality: 85%
?f=webp         # Format: WebP
```

**Example:**
```
https://cdn.yourdomain.com/uploads/image.jpg?w=400&h=300&q=80&f=webp
```

## Performance Monitoring

### Key Metrics to Track:
1. **Cache Hit Ratio**: Should be > 90%
2. **Time to First Byte (TTFB)**: < 100ms
3. **Origin Request Rate**: Should be minimal
4. **Bandwidth Savings**: Expect 60-80% reduction

### Tools:
- CloudFront: AWS CloudWatch
- Cloudflare: Analytics Dashboard
- BunnyCDN: Statistics Panel

## Best Practices

### 1. Use Immutable URLs
All uploaded files use unique IDs in their paths, ensuring URLs never change:
```javascript
// Good - Unique filename
uploads/images/abc123def456.jpg

// Bad - Overwritable filename
uploads/images/profile.jpg
```

### 2. Preconnect to CDN
Add this to your HTML `<head>`:
```html
<link rel="preconnect" href="https://cdn.yourdomain.com">
<link rel="dns-prefetch" href="https://cdn.yourdomain.com">
```

### 3. Lazy Load Images
The platform includes a `LazyImage` component that:
- Loads images only when visible
- Shows blur placeholder
- Supports responsive images

**Usage:**
```tsx
import { LazyImage } from '@/components/ui/lazy-image'

<LazyImage
  src="https://cdn.yourdomain.com/image.jpg"
  alt="Description"
  className="w-full h-auto"
/>
```

### 4. Use WebP Format
Modern browsers support WebP with better compression:
```tsx
<ResponsiveImage
  src="image.jpg"
  srcSet="image.webp 1x, image@2x.webp 2x"
  alt="Description"
/>
```

### 5. Set Appropriate Sizes
Use the `sizes` attribute for responsive images:
```tsx
<LazyImage
  src="image.jpg"
  sizes="(max-width: 768px) 100vw, 50vw"
  alt="Description"
/>
```

## Cache Invalidation

### When to Invalidate:
- User deletes content
- Content is updated (rare, usually versioned)
- Emergency content removal

### How to Invalidate:

**CloudFront:**
```bash
aws cloudfront create-invalidation \
  --distribution-id E1234ABCD \
  --paths "/uploads/specific-file.jpg" "/uploads/*"
```

**Cloudflare:**
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://cdn.yourdomain.com/uploads/file.jpg"]}'
```

**BunnyCDN:**
```bash
curl -X POST "https://api.bunny.net/pullzone/{id}/purgeCache" \
  -H "AccessKey: {api_key}" \
  -H "Content-Type: application/json" \
  --data '{"url":"https://yourzone.b-cdn.net/uploads/file.jpg"}'
```

## Security Considerations

### 1. Signed URLs for Private Content
Private content requires signed URLs:
```typescript
const signedUrl = await mediaService.getSignedUrl(contentFileId, userId);
```

### 2. CORS Configuration
Set appropriate CORS headers on your origin:
```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }]
}
```

### 3. Prevent Hotlinking
Use referer checking on CDN:
```
Cloudflare Page Rule:
- Referer: not from yourdomain.com
- Action: Block
```

## Cost Optimization

### Tips to Reduce CDN Costs:
1. **Enable Compression**: Reduces bandwidth by 60-80%
2. **Use WebP**: Smaller file sizes than JPEG/PNG
3. **Optimize Images**: Use appropriate quality settings (80-85%)
4. **Set Long Cache Times**: Reduces origin requests
5. **Monitor Cache Hit Ratio**: Improve caching strategy

### Expected Costs (approximate):
- **CloudFront**: $0.085/GB (US/Europe)
- **Cloudflare**: Free for first 1TB on Pro plan
- **BunnyCDN**: $0.01/GB (volume tier 0-500TB)

## Testing

### Test Cache Headers:
```bash
curl -I https://cdn.yourdomain.com/uploads/image.jpg

# Look for:
# Cache-Control: public, max-age=31536000, immutable
# CF-Cache-Status: HIT (Cloudflare)
# X-Cache: Hit from cloudfront (CloudFront)
```

### Test Image Optimization:
```bash
# Original
curl -I https://cdn.yourdomain.com/image.jpg

# Optimized
curl -I https://cdn.yourdomain.com/image.jpg?w=400&f=webp
```

## Troubleshooting

### Issue: Low Cache Hit Ratio
**Solution**:
- Check query string forwarding
- Verify cache key configuration
- Ensure URLs are consistent

### Issue: Slow First Load
**Solution**:
- Enable prefetch/preconnect
- Use lazy loading
- Implement progressive image loading

### Issue: Stale Content
**Solution**:
- Check cache invalidation
- Verify versioned URLs
- Review cache TTL settings

## Support

For CDN configuration assistance:
- Check provider documentation
- Review application logs
- Contact DevOps team
