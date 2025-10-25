# Architecture OFM - Plateforme de Créateurs de Contenu

## Vue d'ensemble

OFM est une plateforme de monétisation pour créateurs de contenu construite avec une architecture moderne et scalable.

## Stack Technique

### Backend
- **Framework**: NestJS (Node.js 20+)
- **Language**: TypeScript
- **API**: RESTful + WebSocket (à venir)
- **Architecture**: Modulaire / Microservices-ready

### Base de données
- **PostgreSQL 15+**: Base principale (transactions, utilisateurs)
- **Redis 7+**: Cache, sessions, rate limiting
- **Prisma ORM**: Type-safe database access

### Authentification & Sécurité
- **JWT**: Access tokens (15 min) + Refresh tokens (7 jours)
- **2FA**: TOTP (compatible Google Authenticator)
- **Bcrypt**: Hashing des mots de passe (12 rounds)
- **Helmet**: Security headers
- **CORS**: Configuré par environnement
- **Rate Limiting**: 100 requêtes/minute par défaut

### Paiements
- **Stripe Connect**: Marketplace payments
- **Webhook handling**: Event-driven
- **PCI Compliance**: Jamais de stockage de cartes

### Stockage
- **MinIO** (dev): S3-compatible local storage
- **AWS S3** (prod): Stockage médias chiffré
- **CloudFront/Cloudflare**: CDN avec signed URLs

### Queue & Jobs
- **Bull**: Job queue avec Redis
- **RabbitMQ**: Message broker (événements asynchrones)

### Monitoring
- **Winston**: Logging structuré
- **Sentry**: Error tracking
- **Health checks**: Built-in

## Architecture des Modules

```
┌─────────────────────────────────────────────────────────────────┐
│                          API Gateway                            │
│                  (NestJS + Rate Limiting)                       │
└─────────────┬───────────────────────────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │   Auth Module     │
    │  - JWT Strategy   │
    │  - 2FA (TOTP)     │
    │  - Refresh Token  │
    └─────────┬─────────┘
              │
    ┌─────────┴─────────────────────────────────────────────┐
    │                                                         │
┌───┴────┐  ┌──────┐  ┌─────────┐  ┌──────────┐  ┌─────────┐
│ Users  │  │ Pay- │  │ Content │  │ Subscrip │  │ Messag- │
│ Module │  │ments │  │ Module  │  │ tions    │  │ ing     │
└───┬────┘  └──┬───┘  └────┬────┘  └────┬─────┘  └────┬────┘
    │          │           │            │             │
    └──────────┴───────────┴────────────┴─────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
         ┌────┴─────┐            ┌─────┴──────┐
         │ Database │            │   Redis    │
         │ (Prisma) │            │  (Cache)   │
         └──────────┘            └────────────┘
```

## Modules Détaillés

### 1. Auth Module
**Responsabilités**:
- Inscription / Connexion
- Génération et validation JWT
- Gestion refresh tokens
- 2FA (activation, vérification, désactivation)
- Blacklist de tokens
- Session management

**Endpoints**:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/2fa/enable`
- `POST /auth/2fa/verify`
- `POST /auth/2fa/disable`

**Guards & Decorators**:
- `JwtAuthGuard`: Protection des routes
- `RolesGuard`: Contrôle d'accès basé sur les rôles
- `@CurrentUser()`: Injection de l'utilisateur courant
- `@Roles()`: Définir les rôles autorisés
- `@Public()`: Marquer une route comme publique

### 2. Users Module
**Responsabilités**:
- Profils utilisateurs (créateurs/abonnés)
- Stats créateurs
- Mise à jour profil
- Avatar/Cover upload

**Endpoints**:
- `GET /users/me`
- `GET /users/:username`
- `PUT /users/profile`
- `GET /users/stats`

### 3. Payments Module
**Responsabilités**:
- Intégration Stripe
- Payment intents
- Stripe Connect (creators)
- Webhooks Stripe
- Transaction history
- Payouts

**Services**:
- `StripeService`: Wrapper Stripe
- `PaymentsService`: Business logic

### 4. Subscriptions Module
**Responsabilités**:
- Gestion des paliers d'abonnement
- Souscription/Annulation
- Renouvellement automatique
- Historique

### 5. Content Module
**Responsabilités**:
- Upload de contenu
- Processing (images/vidéos)
- Modération
- Feed algorithmique
- PPV (Pay-Per-View)
- Likes/Comments

### 6. Messaging Module
**Responsabilités**:
- Messages 1-to-1
- Messages PPV
- Chiffrement end-to-end (à venir)
- Notifications temps réel

### 7. Notifications Module
**Responsabilités**:
- Notifications in-app
- Push notifications (à venir)
- Email notifications
- Préférences utilisateur

## Flux de Données

### 1. Inscription Créateur
```
Client
  │
  ├─> POST /auth/register
  │     { email, username, password, role: "CREATOR" }
  │
  ├─> Auth Service
  │     ├─ Validation DTO
  │     ├─ Hash password (bcrypt)
  │     ├─ Create User (PostgreSQL)
  │     └─ Create CreatorProfile
  │
  └─> Response
        { user, message }
```

### 2. Login avec 2FA
```
Client
  │
  ├─> POST /auth/login
  │     { email, password }
  │
  ├─> Auth Service
  │     ├─ Find user
  │     ├─ Verify password
  │     ├─ Check 2FA enabled?
  │     │   ├─ Yes: Require TOTP code
  │     │   └─ No: Continue
  │     ├─ Generate JWT tokens
  │     ├─ Save refresh token (DB)
  │     └─ Update lastLoginAt
  │
  └─> Response
        { user, accessToken, refreshToken }
```

### 3. Paiement Abonnement
```
Client
  │
  ├─> POST /subscriptions/subscribe
  │     { tierId, paymentMethodId }
  │
  ├─> Subscriptions Service
  │     ├─ Get tier info
  │     ├─ Stripe: Create subscription
  │     ├─ Create Transaction (DB)
  │     └─ Create Subscription (DB)
  │
  ├─> Stripe Webhook (async)
  │     ├─ subscription.created
  │     ├─ Update subscription status
  │     └─ Send notification
  │
  └─> Response
        { subscription }
```

## Sécurité

### Authentification
- **JWT**: HS256, expiration courte (15min)
- **Refresh tokens**: Stockés en DB, rotation automatique
- **Blacklist**: Tokens révoqués dans Redis (TTL = expiration)

### Autorisation
- **RBAC**: Creator, Subscriber, Admin, Moderator
- **Resource ownership**: Vérification automatique
- **Guards**: Application à tous les niveaux

### Rate Limiting
```typescript
@ThrottlerGuard({
  ttl: 60,     // 60 secondes
  limit: 100   // 100 requêtes
})
```

### Validation
- **class-validator**: Validation automatique des DTOs
- **Sanitization**: XSS prevention
- **Type safety**: TypeScript strict mode

### Headers de sécurité (Helmet)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000`
- `Content-Security-Policy: default-src 'self'`

## Performance

### Caching Strategy
```
┌──────────────────────────────────────────┐
│ Request                                  │
└───┬──────────────────────────────────────┘
    │
    ├─> Check Redis Cache
    │     ├─ HIT: Return cached data
    │     └─ MISS: Continue
    │
    ├─> Database Query (PostgreSQL)
    │     └─ Store in Redis (TTL: 5min)
    │
    └─> Response
```

**Clés de cache**:
- `user:{id}`: Profil utilisateur (TTL: 5min)
- `content:{id}`: Contenu (TTL: 10min)
- `feed:{userId}`: Feed personnalisé (TTL: 2min)
- `stats:{userId}`: Statistiques (TTL: 15min)

### Database Optimization
- **Indexes**: Sur toutes les foreign keys et champs de recherche
- **Connection pooling**: Prisma géré automatiquement
- **Query optimization**: Select only needed fields

### CDN Strategy
- **Images**: Cloudflare Image Resizing
- **Videos**: Adaptive bitrate streaming (HLS)
- **Signed URLs**: Expiration 1h
- **Cache-Control**: headers optimisés

## Scalabilité

### Horizontal Scaling
```
     ┌─────────────┐
     │ Load Bal.   │
     │ (Nginx)     │
     └──────┬──────┘
            │
    ┌───────┴───────┐
    │               │
┌───┴───┐       ┌───┴───┐
│ API 1 │       │ API 2 │
└───┬───┘       └───┬───┘
    │               │
    └───────┬───────┘
            │
     ┌──────┴──────┐
     │ PostgreSQL  │
     │ (Primary)   │
     └─────────────┘
```

### Database Scaling
- **Read replicas**: Pour analytics et rapports
- **Partitioning**: Par date (content, transactions)
- **Archiving**: Anciennes données vers S3

### Job Queue Scaling
- **Bull workers**: Plusieurs instances
- **Redis cluster**: Pour haute disponibilité
- **Priority queues**: Critique > Normal > Low

## Monitoring & Observability

### Metrics
- **Request latency**: p50, p95, p99
- **Error rate**: 4xx, 5xx
- **Database queries**: Slow query log
- **Cache hit rate**: Redis stats

### Logging
```typescript
// Structured logging
logger.log('User logged in', {
  userId: user.id,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  timestamp: new Date().toISOString(),
});
```

### Alerting
- **Error rate > 5%**: Alert Sentry
- **Response time > 1s**: Alert team
- **Database connections > 80%**: Scale alert

## Déploiement

### Environnements
1. **Development**: Local (Docker Compose)
2. **Staging**: AWS/DigitalOcean
3. **Production**: AWS Multi-AZ

### CI/CD Pipeline
```
GitHub Push
  │
  ├─> Run Tests
  │     ├─ Unit tests
  │     ├─ E2E tests
  │     └─ Security scan
  │
  ├─> Build Docker Image
  │     └─ Push to ECR/DockerHub
  │
  └─> Deploy
        ├─ Staging (auto)
        └─ Production (manual approval)
```

### Infrastructure as Code
- **Terraform**: AWS resources
- **Docker Compose**: Development
- **Kubernetes**: Production (optional)

## Prochaines Évolutions

### Phase 2 (Q2 2024)
- [ ] WebSocket pour messaging temps réel
- [ ] Live streaming (WebRTC)
- [ ] Stories (24h)
- [ ] Advanced analytics

### Phase 3 (Q3 2024)
- [ ] GraphQL API
- [ ] Mobile app (React Native)
- [ ] AI content moderation
- [ ] Multi-currency support

### Phase 4 (Q4 2024)
- [ ] Cryptocurrency payments
- [ ] NFT integration
- [ ] API publique pour développeurs
- [ ] White-label solution

---

**Version**: 1.0.0
**Dernière mise à jour**: 2024-01-XX
**Auteur**: OFM Team
