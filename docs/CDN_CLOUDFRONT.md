# Configuration AWS CloudFront CDN pour OFM Platform

## Vue d'ensemble

Guide de configuration d'AWS CloudFront comme CDN pour servir les assets statiques et médias de la plateforme OFM avec de hautes performances et une faible latence globale.

## Prérequis

- Compte AWS
- Bucket S3 configuré pour les uploads
- AWS CLI installé
- Certificat SSL dans AWS Certificate Manager

## Architecture

```
Users → CloudFront → Origin (S3 ou Custom)
              ↓
          Edge Locations (200+ worldwide)
```

## Configuration S3 Origin

### 1. Créer un Bucket S3

```bash
aws s3 mb s3://ofm-cdn-assets --region us-east-1

# Configurer les permissions
aws s3api put-bucket-cors --bucket ofm-cdn-assets --cors-configuration file://cors.json
```

**cors.json**:
```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }]
}
```

### 2. Créer Origin Access Identity (OAI)

```bash
aws cloudfront create-cloud-front-origin-access-identity \
  --cloud-front-origin-access-identity-config \
  CallerReference=ofm-oai-$(date +%s),Comment="OFM CDN OAI"
```

### 3. Configurer Bucket Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontAccess",
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity YOUR_OAI_ID"
    },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::ofm-cdn-assets/*"
  }]
}
```

## Créer Distribution CloudFront

### Via Console AWS

1. **CloudFront** → **Create Distribution**
2. **Origin Settings**:
   - Origin Domain: `ofm-cdn-assets.s3.amazonaws.com`
   - Origin Path: `/` (vide)
   - Origin Access: **Origin Access Identity**
   - OAI: Sélectionner celle créée
   - Bucket Policy: **Yes, update bucket policy**

3. **Default Cache Behavior**:
   - Viewer Protocol Policy: **Redirect HTTP to HTTPS**
   - Allowed HTTP Methods: **GET, HEAD, OPTIONS**
   - Cache Policy: **CachingOptimized**
   - Origin Request Policy: **CORS-S3Origin**

4. **Distribution Settings**:
   - Price Class: **Use All Edge Locations** (ou Europe/US seulement)
   - Alternate Domain Names (CNAMEs): `cdn.yourdomain.com`
   - SSL Certificate: **Custom SSL Certificate** (depuis ACM)
   - Default Root Object: `index.html`

5. **Create Distribution**

### Via AWS CLI

```bash
aws cloudfront create-distribution \
  --distribution-config file://cloudfront-config.json
```

**cloudfront-config.json**:
```json
{
  "CallerReference": "ofm-distribution",
  "Comment": "OFM Platform CDN",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "S3-ofm-cdn-assets",
      "DomainName": "ofm-cdn-assets.s3.amazonaws.com",
      "S3OriginConfig": {
        "OriginAccessIdentity": "origin-access-identity/cloudfront/YOUR_OAI_ID"
      }
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-ofm-cdn-assets",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 3,
      "Items": ["GET", "HEAD", "OPTIONS"]
    },
    "Compress": true,
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6"
  },
  "ViewerCertificate": {
    "ACMCertificateArn": "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  }
}
```

## Configuration SSL/TLS

### Créer Certificat dans ACM

⚠️ Le certificat **DOIT** être dans **us-east-1** pour CloudFront!

```bash
# Demander un certificat
aws acm request-certificate \
  --domain-name cdn.yourdomain.com \
  --validation-method DNS \
  --region us-east-1

# Valider via DNS (ajouter le CNAME dans votre DNS)
```

### Configurer HTTPS

- **Viewer Protocol Policy**: Redirect HTTP to HTTPS
- **Minimum TLS Version**: TLSv1.2_2021
- **Security Policy**: TLSv1.2_2021 (recommended)

## Cache Behaviors

### Images

```json
{
  "PathPattern": "*.{jpg,jpeg,png,gif,webp,svg}",
  "Compress": true,
  "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
  "TTL": {
    "Min": 86400,
    "Max": 31536000,
    "Default": 604800
  }
}
```

### Vidéos

```json
{
  "PathPattern": "*.{mp4,webm,mov}",
  "Compress": false,
  "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
  "TTL": {
    "Min": 86400,
    "Max": 31536000,
    "Default": 2592000
  }
}
```

### JavaScript/CSS

```json
{
  "PathPattern": "*.{js,css}",
  "Compress": true,
  "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
  "TTL": {
    "Min": 3600,
    "Max": 86400,
    "Default": 86400
  }
}
```

## Invalidation du Cache

### Via AWS CLI

```bash
# Invalider tous les fichiers
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"

# Invalider des fichiers spécifiques
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/images/*" "/css/style.css"
```

### Via Code (Node.js)

```javascript
const AWS = require('aws-sdk');
const cloudfront = new AWS.CloudFront();

async function invalidateCache(paths) {
  const params = {
    DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
    InvalidationBatch: {
      CallerReference: `invalidation-${Date.now()}`,
      Paths: {
        Quantity: paths.length,
        Items: paths
      }
    }
  };

  const result = await cloudfront.createInvalidation(params).promise();
  console.log('Invalidation created:', result.Invalidation.Id);
}

// Usage
invalidateCache(['/*']);
```

⚠️ **Coût**: Les 1000 premières invalidations/mois sont gratuites, puis 0.005$ par path.

## Configuration DNS

Ajoutez un enregistrement CNAME dans votre DNS:

```
Type: CNAME
Name: cdn
Value: d1234567890.cloudfront.net
TTL: 300
```

## Monitoring et Logs

### Activer les Logs Standards

```bash
aws cloudfront update-distribution \
  --id YOUR_DISTRIBUTION_ID \
  --distribution-config file://logging-config.json
```

**logging-config.json**:
```json
{
  "Logging": {
    "Enabled": true,
    "IncludeCookies": false,
    "Bucket": "ofm-cloudfront-logs.s3.amazonaws.com",
    "Prefix": "cdn/"
  }
}
```

### CloudWatch Metrics

Métriques disponibles automatiquement:
- Requests
- BytesDownloaded
- BytesUploaded
- 4xxErrorRate
- 5xxErrorRate
- TotalErrorRate

### Créer des Alarmes

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cloudfront-high-error-rate \
  --alarm-description "Alert when error rate > 5%" \
  --metric-name 4xxErrorRate \
  --namespace AWS/CloudFront \
  --statistic Average \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold
```

## Optimisations

### Lambda@Edge

Exécutez du code à la périphérie pour:
- Redirection d'URLs
- A/B testing
- Authentification
- Manipulation d'headers

**Exemple: Ajouter Security Headers**

```javascript
exports.handler = (event, context, callback) => {
  const response = event.Records[0].cf.response;
  const headers = response.headers;

  headers['strict-transport-security'] = [{
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains'
  }];
  
  headers['x-content-type-options'] = [{
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  }];

  callback(null, response);
};
```

### Compression

CloudFront compresse automatiquement les fichiers > 1KB:
- text/html
- text/css
- text/javascript
- application/javascript
- application/json

Pour activer: **Compress Objects Automatically: Yes**

## Coûts

### Pricing (Région US)

| Type | Coût |
|------|------|
| Data Transfer Out (premiers 10 TB/mois) | 0.085$/GB |
| Data Transfer Out (10-50 TB/mois) | 0.080$/GB |
| HTTP/HTTPS Requests | 0.0075$ pour 10,000 requests |
| Invalidations | Gratuit pour 1000/mois, puis 0.005$/path |
| Lambda@Edge Requests | 0.60$ par million |

**Estimation mensuelle** pour 1TB/mois:
- Data Transfer: ~85$
- Requests (100M): ~75$
- **Total**: ~160$/mois

💡 **Économie**: Gratuit sur S3 directement, mais CloudFront améliore les performances globalement.

## Sécurité

### Signed URLs/Cookies

Pour contenu privé:

```javascript
const AWS = require('aws-sdk');
const signer = new AWS.CloudFront.Signer(
  process.env.CLOUDFRONT_KEY_PAIR_ID,
  process.env.CLOUDFRONT_PRIVATE_KEY
);

const signedUrl = signer.getSignedUrl({
  url: 'https://cdn.yourdomain.com/premium-content.mp4',
  expires: Math.floor(Date.now() / 1000) + 3600 // 1 hour
});
```

### WAF Integration

Activez AWS WAF pour bloquer:
- SQL Injection
- XSS
- Bot traffic
- DDoS

```bash
aws wafv2 associate-web-acl \
  --web-acl-arn arn:aws:wafv2:us-east-1:ACCOUNT_ID:global/webacl/NAME/ID \
  --resource-arn arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID
```

## Terraform Configuration

```hcl
resource "aws_cloudfront_distribution" "ofm_cdn" {
  origin {
    domain_name = aws_s3_bucket.cdn_assets.bucket_regional_domain_name
    origin_id   = "S3-ofm-cdn-assets"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.oai.cloudfront_access_identity_path
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "OFM Platform CDN"
  default_root_object = "index.html"

  aliases = ["cdn.yourdomain.com"]

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-ofm-cdn-assets"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  price_class = "PriceClass_100"

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.cdn.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
```

## Ressources

- [CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [Lambda@Edge](https://aws.amazon.com/lambda/edge/)
- [CloudFront Developer Guide](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/)
