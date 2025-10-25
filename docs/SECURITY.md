# Guide de Sécurité OFM

## 🔒 Vue d'ensemble

La sécurité est la priorité absolue pour OFM. Ce document décrit toutes les mesures de sécurité implémentées et les bonnes pratiques à suivre.

## Authentification

### JWT (JSON Web Tokens)

**Configuration**:
- **Algorithm**: HS256
- **Access Token**: 15 minutes d'expiration
- **Refresh Token**: 7 jours d'expiration
- **Secret rotation**: Tous les 90 jours (recommandé)

**Implémentation**:
```typescript
// Access token payload
{
  sub: userId,
  email: user.email,
  username: user.username,
  role: user.role,
  iat: issuedAt,
  exp: expiresAt
}
```

**Sécurité**:
- ✅ Secrets stockés dans variables d'environnement
- ✅ Jamais exposés côté client
- ✅ Rotation automatique des refresh tokens
- ✅ Blacklist des tokens révoqués (Redis)

### 2FA (Two-Factor Authentication)

**Méthode**: TOTP (Time-based One-Time Password)
- Compatible Google Authenticator, Authy, etc.
- Window de 2 périodes (60 secondes)
- QR code généré pour setup facile

**Flow d'activation**:
```
1. User: POST /auth/2fa/enable
2. Server: Génère secret + QR code
3. Server: Stocke secret temporairement (Redis, 10min)
4. User: Scanne QR avec app authenticator
5. User: POST /auth/2fa/verify { code: "123456" }
6. Server: Vérifie code
7. Server: Active 2FA + sauvegarde secret (DB encrypted)
```

### Password Hashing

**Algorithme**: bcrypt
**Rounds**: 12 (configurable via `BCRYPT_ROUNDS`)

```typescript
// Never do this
password === hashedPassword ❌

// Always do this
await bcrypt.compare(password, hashedPassword) ✅
```

**Politique de mots de passe**:
- Minimum 8 caractères
- Au moins 1 majuscule
- Au moins 1 minuscule
- Au moins 1 chiffre
- Au moins 1 caractère spécial (@$!%*?&)

## Autorisation

### RBAC (Role-Based Access Control)

**Rôles**:
```typescript
enum UserRole {
  CREATOR,     // Créateur de contenu
  SUBSCRIBER,  // Abonné
  ADMIN,       // Administrateur
  MODERATOR    // Modérateur
}
```

**Implémentation**:
```typescript
@Get('stats')
@Roles(UserRole.CREATOR)
@UseGuards(JwtAuthGuard, RolesGuard)
async getStats(@CurrentUser() user) {
  // Seuls les créateurs peuvent accéder
}
```

### Resource Ownership

Vérification automatique que l'utilisateur est propriétaire de la ressource :

```typescript
// ❌ Mauvais - N'importe qui peut modifier
@Put('content/:id')
async update(@Param('id') id: string, @Body() dto) {
  return this.contentService.update(id, dto);
}

// ✅ Bon - Vérification du propriétaire
@Put('content/:id')
async update(
  @Param('id') id: string,
  @CurrentUser('id') userId: string,
  @Body() dto
) {
  const content = await this.contentService.findOne(id);
  if (content.creatorId !== userId) {
    throw new ForbiddenException();
  }
  return this.contentService.update(id, dto);
}
```

## Protection des Données

### Encryption at Rest

**Base de données**:
- PostgreSQL: Encryption native avec pgcrypto
- Champs sensibles: `twoFactorSecret`, données bancaires
- Méthode: AES-256-GCM

```sql
-- Exemple de champ chiffré
CREATE TABLE users (
  id UUID PRIMARY KEY,
  two_factor_secret BYTEA -- Encrypted with pgcrypto
);
```

**Fichiers médias**:
- S3 Server-Side Encryption (SSE-S3)
- KMS pour clés de chiffrement
- Access via signed URLs uniquement

### Encryption in Transit

**TLS/SSL**:
- TLS 1.3 minimum
- HSTS activé (max-age: 31536000)
- Certificats Let's Encrypt (auto-renouvelés)

**Configuration Nginx**:
```nginx
server {
  listen 443 ssl http2;
  ssl_protocols TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
}
```

### Données Sensibles (PII)

**Masking dans les logs**:
```typescript
// ❌ Ne jamais logger
logger.log('User login', { password: user.password });

// ✅ Toujours masquer
logger.log('User login', {
  userId: user.id,
  email: maskEmail(user.email) // u***@example.com
});
```

**RGPD Compliance**:
- Droit à l'oubli: Soft delete + anonymisation après 30j
- Portabilité: Export JSON des données
- Consentement: Tracking explicite

## Rate Limiting

### Configuration

**Global**:
- 100 requêtes / minute par IP
- 1000 requêtes / heure par utilisateur

**Endpoints sensibles**:
```typescript
@Post('login')
@Throttle(5, 60) // 5 tentatives / minute
async login(@Body() dto: LoginDto) {
  // ...
}

@Post('register')
@Throttle(3, 3600) // 3 comptes / heure par IP
async register(@Body() dto: RegisterDto) {
  // ...
}
```

**Stockage**: Redis avec clés `ratelimit:{ip}:{endpoint}`

### Brute Force Protection

**Login**:
- Max 5 tentatives / 15 minutes
- Lockout 1h après 5 échecs
- Captcha après 3 échecs

**2FA**:
- Max 3 tentatives / 5 minutes
- Lockout temporaire après échecs

## CORS (Cross-Origin Resource Sharing)

**Configuration**:
```typescript
app.enableCors({
  origin: ['https://app.ofm.com', 'https://creators.ofm.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-Total-Count', 'X-Page'],
});
```

**⚠️ Jamais en production**:
```typescript
origin: '*' // ❌ DANGER !
```

## Security Headers

**Helmet Configuration**:
```typescript
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.stripe.com'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
})
```

## Input Validation

### DTO Validation

**class-validator** sur tous les DTOs :

```typescript
export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
  password: string;
}
```

### SQL Injection Prevention

✅ **Prisma ORM** - Protection automatique
```typescript
// ✅ Safe - Parameterized query
await prisma.user.findUnique({
  where: { email: userInput }
});

// ❌ NEVER use raw SQL with user input
await prisma.$executeRaw(`SELECT * FROM users WHERE email = '${userInput}'`);
```

### XSS Prevention

**Sanitization**:
- Tous les inputs HTML sont échappés
- `class-sanitizer` pour nettoyage automatique
- CSP headers pour bloquer scripts inline

```typescript
import { sanitize } from 'class-sanitizer';

@Post('comment')
async create(@Body() dto: CreateCommentDto) {
  dto.text = sanitize(dto.text); // Remove HTML tags
  return this.commentsService.create(dto);
}
```

## File Upload Security

### Validation

**Type MIME vérification**:
```typescript
const ALLOWED_IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEOS = ['video/mp4', 'video/quicktime'];

if (!ALLOWED_IMAGES.includes(file.mimetype)) {
  throw new BadRequestException('Invalid file type');
}
```

**Taille maximale**:
- Images: 10 MB
- Vidéos: 500 MB
- Audio: 50 MB

**Scanning**:
- ClamAV pour scan antivirus
- EXIF stripping pour remove metadata
- Content-Type sniffing prevention

### Storage

**Signed URLs** (expiration 1h):
```typescript
const url = await s3.getSignedUrl('getObject', {
  Bucket: 'ofm-content',
  Key: 'content/xxx.jpg',
  Expires: 3600, // 1 hour
});
```

**Watermarking automatique**:
```typescript
await sharp(inputBuffer)
  .composite([{
    input: watermarkBuffer,
    gravity: 'southeast',
  }])
  .toFile(outputPath);
```

## Secrets Management

### Development

**.env files** (JAMAIS commités):
```bash
# .gitignore
.env
.env.local
.env.*.local
```

### Production

**AWS Secrets Manager / HashiCorp Vault**:
```typescript
// ❌ Hard-coded secrets
const apiKey = 'sk_live_xxx';

// ✅ From secure store
const apiKey = await secretsManager.getSecret('stripe/api_key');
```

**Rotation**:
- JWT secrets: Tous les 90 jours
- Database passwords: Tous les 6 mois
- API keys: On demand

## Monitoring & Auditing

### Audit Logs

**Événements trackés**:
```typescript
enum AuditAction {
  USER_LOGIN = 'user.login',
  USER_LOGOUT = 'user.logout',
  USER_REGISTER = 'user.register',
  PAYMENT_CREATED = 'payment.created',
  CONTENT_PUBLISHED = 'content.published',
  SETTINGS_CHANGED = 'settings.changed',
}
```

**Stockage**:
- Table `audit_log` (PostgreSQL)
- Retention: 1 an
- Export vers S3 pour compliance

### Error Tracking

**Sentry**:
- Capture tous les 5xx errors
- PII redacted automatiquement
- Source maps pour debugging

**Logs structurés**:
```typescript
logger.error('Payment failed', {
  userId: user.id,
  amount: payment.amount,
  error: err.message,
  // NO sensitive data (card numbers, etc.)
});
```

## Content Moderation

### CSAM Detection

**PhotoDNA / Google SafeSearch**:
- Scan automatique de toutes les images
- Blocage immédiat si détecté
- Report aux autorités (NCMEC)

### NSFW Detection

**AI-based**:
- TensorFlow.js model
- Classification: Safe / Questionable / Unsafe
- Manual review pour Questionable

### User Reports

**DMCA Takedown**:
- Form de signalement
- Review sous 24h
- Automatic takedown si vérifié

## Compliance

### PCI-DSS

✅ **Nous ne stockons JAMAIS les cartes bancaires**
- Stripe gère 100% des paiements
- Tokens uniquement (non sensibles)

### RGPD

**Droits des utilisateurs**:
- ✅ Accès aux données: `GET /users/me/data-export`
- ✅ Portabilité: Export JSON/CSV
- ✅ Rectification: `PUT /users/me`
- ✅ Suppression: `DELETE /users/me`

**Cookie consent**:
- Banner obligatoire
- Opt-in explicite
- Révocation facile

### KYC/AML

**Vérification créateurs**:
- Stripe Identity / Onfido
- Documents requis: ID + Proof of address
- Review sous 48h
- Revalidation annuelle

## Incident Response

### Plan de réponse

1. **Détection**: Alertes automatiques (Sentry, CloudWatch)
2. **Isolation**: Bloquer accès si nécessaire
3. **Investigation**: Analyse logs, audit trail
4. **Mitigation**: Patch, déploiement urgence
5. **Communication**: Notification utilisateurs si breach
6. **Post-mortem**: Document + amélioration

### Contacts

**Security Team**:
- Email: security@ofm.com
- PGP Key: [Publié sur site]
- Bug Bounty: HackerOne

## Security Checklist (Pre-Production)

### Infrastructure
- [ ] Firewall configuré (ports 80, 443 uniquement)
- [ ] WAF activé (Cloudflare)
- [ ] DDoS protection
- [ ] VPC network segmentation
- [ ] Bastion host pour accès DB
- [ ] SSH keys only (no password)

### Application
- [ ] Tous les secrets en variables d'env
- [ ] JWT secrets générés aléatoirement
- [ ] 2FA obligatoire pour admins
- [ ] Rate limiting activé
- [ ] Input validation complète
- [ ] Error messages génériques (no stack traces)

### Monitoring
- [ ] Sentry configuré
- [ ] Logs centralisés
- [ ] Alertes configurées
- [ ] Backups automatiques quotidiens
- [ ] Disaster recovery testé

### Compliance
- [ ] RGPD privacy policy
- [ ] Terms of service
- [ ] Cookie consent
- [ ] DMCA agent registered
- [ ] 2257 compliance (si contenu adulte US)

## Mises à Jour de Sécurité

**Schedule**:
- Dependencies: Scan quotidien (Dependabot)
- OS patches: Hebdomadaire
- Security audits: Trimestriel
- Penetration testing: Annuel

**Process**:
```bash
# Vérifier vulnérabilités
npm audit

# Update automatique (patch + minor)
npm update

# Review major versions manuellement
npm outdated
```

## Ressources

### Outils recommandés
- **OWASP ZAP**: Pen testing
- **Burp Suite**: Security testing
- **SonarQube**: Code quality & security
- **Snyk**: Dependency scanning

### Standards
- OWASP Top 10
- NIST Cybersecurity Framework
- CIS Controls
- PCI-DSS (si applicable)

### Training
- **OWASP Cheat Sheets**: https://cheatsheetseries.owasp.org/
- **Portswigger Academy**: https://portswigger.net/web-security

---

**Version**: 1.0.0
**Dernière mise à jour**: 2024-01-XX
**Contact**: security@ofm.com
**Bug Bounty**: https://hackerone.com/ofm
