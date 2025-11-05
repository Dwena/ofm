# DevOps - OFM Platform

Documentation complète de l'infrastructure DevOps et du déploiement de la plateforme OFM.

## 📋 Table des Matières

1. [Docker](#docker)
2. [CI/CD avec GitHub Actions](#cicd)
3. [Variables d'Environnement](#environment-variables)
4. [Monitoring](#monitoring)
5. [SSL/TLS](#ssltls)
6. [CDN](#cdn)
7. [Déploiement](#deployment)
8. [Sécurité](#security)

---

## 🐳 Docker

### Architecture

```
├── docker-compose.yml
├── apps/
│   ├── api/Dockerfile
│   └── web/Dockerfile
└── nginx/
    ├── nginx.conf
    └── conf.d/ofm.conf
```

### Services

- **postgres**: PostgreSQL 15 (Database)
- **redis**: Redis 7 (Cache & Queues)
- **minio**: MinIO (S3-compatible storage)
- **api**: NestJS backend
- **web**: Next.js frontend
- **nginx**: Reverse proxy
- **certbot**: SSL certificates

### Commandes Essentielles

```bash
# Démarrer tous les services
docker-compose up -d

# Voir les logs
docker-compose logs -f api web

# Rebuild après changements
docker-compose up -d --build

# Arrêter tout
docker-compose down

# Avec suppression des volumes (⚠️ DATA LOSS)
docker-compose down -v

# Exécuter des commandes dans un container
docker-compose exec api npm run migrate
docker-compose exec web npm run build
```

### Configuration Réseau

Réseau interne: `ofm-network`
- Communication inter-services via noms de service
- Exposition des ports uniquement nécessaires

### Volumes Persistants

- `postgres_data`: Données PostgreSQL
- `redis_data`: Données Redis  
- `minio_data`: Fichiers uploadés

### Health Checks

Tous les services ont des health checks configurés:
- Intervalle: 30s
- Timeout: 10s
- Retries: 3

---

## 🔄 CI/CD avec GitHub Actions

### Workflow: `.github/workflows/ci.yml`

#### Jobs

1. **Test & Lint**
   - Lint API et Web
   - Type checking TypeScript
   - Tests unitaires
   - Tests d'intégration
   - Upload coverage vers Codecov

2. **Build Docker Images**
   - Build API et Web
   - Push vers GitHub Container Registry
   - Cache layers pour optimisation

3. **Deploy Production**
   - SSH vers serveur de production
   - Pull dernières images
   - Exécuter migrations
   - Restart services
   - Notification Slack

4. **Security Scan**
   - Trivy vulnerability scanner
   - npm audit
   - Upload SARIF vers GitHub Security

### Secrets Requis

Configurez dans **Settings → Secrets and variables → Actions**:

```
DEPLOY_HOST=server-ip
DEPLOY_USER=deploy-user
DEPLOY_SSH_KEY=private-ssh-key
SLACK_WEBHOOK=https://hooks.slack.com/...
SENTRY_DSN=https://...
```

### Triggers

- **Push** sur `main` → Deploy production
- **Push** sur `develop` → Deploy staging
- **Pull Request** → Tests seulement

---

## 🔐 Variables d'Environnement

### Fichiers

- `.env` - Développement local
- `.env.production` - Production
- `.env.staging` - Staging
- `.env.production.example` - Template

### Variables Critiques

#### Base de Données
```bash
DATABASE_URL=postgresql://user:pass@postgres:5432/ofm
POSTGRES_PASSWORD=CHANGE_ME
```

#### JWT
```bash
JWT_SECRET=CHANGE_ME_MIN_32_CHARS
JWT_REFRESH_SECRET=CHANGE_ME_MIN_32_CHARS
```

#### Stripe
```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=pk_live_...
```

#### AWS/S3
```bash
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=ofm-uploads-prod
```

#### Monitoring
```bash
SENTRY_DSN=https://...@sentry.io/...
NEXT_PUBLIC_LOGROCKET_APP_ID=app-id
```

### Gestion des Secrets

**Production**: Utilisez un gestionnaire de secrets

- AWS Secrets Manager
- HashiCorp Vault  
- Azure Key Vault
- Doppler

**Exemple avec Doppler**:
```bash
# Installation
curl -Ls https://cli.doppler.com/install.sh | sh

# Login
doppler login

# Setup
doppler setup

# Run avec secrets injectés
doppler run -- npm start
```

---

## 📊 Monitoring

### Sentry (Error Tracking)

#### API Configuration

`apps/api/src/sentry.config.ts`:
```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

#### Web Configuration  

`apps/web/lib/monitoring.ts`:
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

### LogRocket (Session Recording)

```typescript
import LogRocket from 'logrocket';

LogRocket.init('app-id');

// Integrate with Sentry
LogRocket.getSessionURL(url => {
  Sentry.setContext('LogRocket', { sessionURL: url });
});
```

### Métriques Disponibles

**Sentry**:
- Errors & Exceptions
- Performance (traces)
- Release tracking
- User feedback

**LogRocket**:
- Session replays
- Console logs
- Network requests
- Redux/state changes

### Dashboards

Créez des dashboards pour surveiller:
- Error rate
- Response times (P50, P95, P99)
- Active users
- API throughput

---

## 🔒 SSL/TLS

### Let's Encrypt avec Certbot

#### Initialisation

```bash
# Configurer les variables
export DOMAIN=yourdomain.com
export SSL_CERT_EMAIL=admin@yourdomain.com

# Exécuter le script d'initialisation
./scripts/init-letsencrypt.sh
```

#### Renouvellement Automatique

Certbot dans le container se charge du renouvellement tous les 12h.

Vérifier manuellement:
```bash
docker-compose exec certbot certbot renew --dry-run
```

### Configuration Nginx

```nginx
# Redirect HTTP → HTTPS
server {
    listen 80;
    return 301 https://$host$request_uri;
}

# HTTPS Server
server {
    listen 443 ssl http2;
    
    ssl_certificate /etc/letsencrypt/live/domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/domain/privkey.pem;
    
    # Modern SSL config
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=31536000" always;
}
```

### Test SSL

```bash
# SSL Labs
https://www.ssllabs.com/ssltest/analyze.html?d=yourdomain.com

# Local test
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

Grade attendu: **A+**

---

## 🌐 CDN

### Option 1: CloudFlare (Recommandé)

**Avantages**:
- Gratuit pour démarrer
- DDoS protection incluse
- WAF intégré
- Simple à configurer

**Setup**:
1. Créer un compte sur [CloudFlare](https://www.cloudflare.com/)
2. Ajouter votre domaine
3. Changer les nameservers
4. Activer SSL/TLS Full (strict)
5. Créer des Page Rules pour le cache

Voir: [`docs/CDN_CLOUDFLARE.md`](./docs/CDN_CLOUDFLARE.md)

### Option 2: AWS CloudFront

**Avantages**:
- Intégration native avec S3
- Lambda@Edge pour logique custom
- Plus de contrôle

**Setup**:
1. Créer une distribution CloudFront
2. Configurer l'origine (S3 ou Custom)
3. Ajouter un certificat ACM
4. Configurer les behaviors de cache

Voir: [`docs/CDN_CLOUDFRONT.md`](./docs/CDN_CLOUDFRONT.md)

### Configuration Recommandée

**Cache TTL**:
- Images: 7 jours
- JS/CSS: 1 jour
- Vidéos: 30 jours
- API: Bypass cache

**Compression**:
- Gzip/Brotli activé
- Min size: 1KB

**Security Headers**:
```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
```

---

## 🚀 Déploiement

### Production Server Setup

#### 1. Prérequis Serveur

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install git
sudo apt install git -y
```

#### 2. Clone Repository

```bash
cd /opt
sudo git clone https://github.com/your-org/ofm.git
cd ofm
```

#### 3. Configuration

```bash
# Copier le fichier d'environnement
cp .env.production.example .env.production

# Éditer les variables
nano .env.production

# Générer des secrets sécurisés
openssl rand -base64 32  # Pour JWT_SECRET
openssl rand -base64 32  # Pour JWT_REFRESH_SECRET
```

#### 4. Premier Déploiement

```bash
# Build les images
docker-compose build

# Démarrer les services
docker-compose up -d

# Exécuter les migrations
docker-compose exec api npx prisma migrate deploy

# Seed la base (optionnel)
docker-compose exec api npm run seed

# Initialiser SSL
./scripts/init-letsencrypt.sh
```

#### 5. Vérifications

```bash
# Check services
docker-compose ps

# Check logs
docker-compose logs -f

# Test API
curl https://api.yourdomain.com/health

# Test Web
curl https://yourdomain.com
```

### Déploiement Continu

Avec GitHub Actions, le déploiement est automatique sur push vers `main`:

1. Tests exécutés
2. Images Docker buildées
3. Push vers registry
4. SSH vers serveur
5. Pull nouvelles images
6. Restart services
7. Migrations DB
8. Notification Slack

### Rollback

En cas de problème:

```bash
# Voir les images précédentes
docker images

# Rollback vers une version
docker-compose down
docker tag old-image:tag current-image:latest
docker-compose up -d

# Ou rollback DB
./apps/api/scripts/restore-database.sh
```

---

## 🛡️ Sécurité

### Checklist Production

- [ ] Toutes les variables sensibles dans `.env`
- [ ] Secrets rotationnés régulièrement
- [ ] HTTPS activé partout
- [ ] HSTS header configuré
- [ ] CSP header configuré
- [ ] Rate limiting activé
- [ ] WAF configuré (CloudFlare ou AWS)
- [ ] Backups automatiques configurés
- [ ] Monitoring activé (Sentry)
- [ ] Logs centralisés
- [ ] Firewall configuré (UFW)
- [ ] SSH key-only auth
- [ ] Fail2ban installé
- [ ] Docker security best practices
- [ ] Dependency scanning (Dependabot)
- [ ] OWASP Top 10 check

### Firewall (UFW)

```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Status
sudo ufw status
```

### Fail2ban

```bash
# Install
sudo apt install fail2ban -y

# Configure
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### Docker Security

```dockerfile
# Run as non-root
USER nodejs

# Read-only root filesystem
RUN apk add --no-cache dumb-init
ENTRYPOINT ["dumb-init", "--"]

# No secrets in images
RUN --mount=type=secret,id=api_key \
    API_KEY=$(cat /run/secrets/api_key) npm install
```

---

## 📈 Performance

### Optimisations

**Backend**:
- Connection pooling (Prisma)
- Redis caching
- Query optimization
- Compression (gzip)

**Frontend**:
- Image optimization (Next.js Image)
- Code splitting
- Lazy loading
- Service Worker caching

**Infrastructure**:
- CDN pour assets statiques
- HTTP/2 & HTTP/3
- Brotli compression
- Edge caching

### Monitoring Performance

**Métriques clés**:
- TTFB (Time To First Byte) < 200ms
- FCP (First Contentful Paint) < 1s
- LCP (Largest Contentful Paint) < 2.5s
- CLS (Cumulative Layout Shift) < 0.1
- API response time P95 < 500ms

**Outils**:
- Lighthouse CI
- WebPageTest
- GTmetrix
- Sentry Performance

---

## 🆘 Troubleshooting

### Services ne démarrent pas

```bash
# Voir les logs
docker-compose logs service-name

# Rebuild
docker-compose build --no-cache service-name
docker-compose up -d service-name
```

### Erreurs de connexion DB

```bash
# Vérifier PostgreSQL
docker-compose logs postgres

# Tester la connexion
docker-compose exec api npx prisma db pull
```

### Erreur 502 Bad Gateway

- Vérifier que l'API tourne: `docker-compose ps`
- Vérifier les logs API: `docker-compose logs api`
- Vérifier nginx config: `docker-compose exec nginx nginx -t`

### Certificat SSL expiré

```bash
# Renouveler manuellement
docker-compose exec certbot certbot renew

# Reload nginx
docker-compose exec nginx nginx -s reload
```

---

## 📚 Ressources

- [Docker Documentation](https://docs.docker.com/)
- [GitHub Actions](https://docs.github.com/en/actions)
- [Let's Encrypt](https://letsencrypt.org/)
- [Sentry Docs](https://docs.sentry.io/)
- [CloudFlare Docs](https://developers.cloudflare.com/)
- [AWS CloudFront](https://docs.aws.amazon.com/cloudfront/)

---

**Dernière mise à jour**: 2025-11-05  
**Mainteneur**: OFM DevOps Team
