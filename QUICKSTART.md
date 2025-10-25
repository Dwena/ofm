# OFM - Guide de Démarrage Rapide

## 🚀 Démarrage en 5 minutes

### Prérequis

- **Node.js** 20+ ([télécharger](https://nodejs.org/))
- **Docker** & **Docker Compose** ([télécharger](https://www.docker.com/))
- **Git** ([télécharger](https://git-scm.com/))

### Installation

```bash
# 1. Cloner le projet
git clone <repo-url>
cd ofm

# 2. Installer les dépendances
npm install

# 3. Copier les fichiers d'environnement
cp apps/api/.env.example apps/api/.env

# 4. Lancer les services Docker
docker-compose up -d

# 5. Attendre que les services démarrent (environ 30 secondes)
docker-compose ps

# 6. Générer le client Prisma
cd apps/api
npm run prisma:generate

# 7. Exécuter les migrations
npm run migration:run

# 8. (Optionnel) Seed la base de données
npm run seed

# 9. Retourner à la racine et lancer l'API
cd ../..
npm run dev
```

### Vérification

L'API devrait être accessible sur : **http://localhost:3001**

Testez avec :
```bash
curl http://localhost:3001/api/v1/health
```

Réponse attendue :
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 12.345,
    "timestamp": "2024-01-XX..."
  }
}
```

## 📊 Services disponibles

Après `docker-compose up -d` :

| Service | URL | Credentials |
|---------|-----|-------------|
| **PostgreSQL** | localhost:5432 | user: `ofm_user` / pass: `ofm_password_dev_only` |
| **Redis** | localhost:6379 | pass: `redis_password_dev_only` |
| **RabbitMQ** | http://localhost:15672 | user: `ofm_user` / pass: `rabbitmq_password_dev_only` |
| **MinIO** (S3) | http://localhost:9001 | user: `minioadmin` / pass: `minioadmin_dev_only` |
| **MailHog** | http://localhost:8025 | - |
| **Adminer** | http://localhost:8080 | - |

## 🔑 Premier utilisateur

### Créer un compte créateur

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "creator@example.com",
    "username": "creator_demo",
    "password": "SecurePass123!",
    "role": "CREATOR"
  }'
```

### Se connecter

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "creator@example.com",
    "password": "SecurePass123!"
  }'
```

Récupérez le `accessToken` dans la réponse :

```json
{
  "success": true,
  "data": {
    "user": {...},
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "..."
  }
}
```

### Accéder à votre profil

```bash
curl -X GET http://localhost:3001/api/v1/users/me \
  -H "Authorization: Bearer <votre_accessToken>"
```

## 📁 Structure du Projet

```
ofm/
├── apps/
│   └── api/                 # Backend NestJS
│       ├── src/
│       │   ├── auth/        # Authentification (JWT, 2FA)
│       │   ├── users/       # Gestion utilisateurs
│       │   ├── content/     # Gestion de contenu
│       │   ├── payments/    # Paiements Stripe
│       │   ├── subscriptions/ # Abonnements
│       │   ├── messaging/   # Messagerie
│       │   ├── notifications/ # Notifications
│       │   └── common/      # Utilitaires (DB, Redis, Logger)
│       ├── prisma/
│       │   └── schema.prisma # Schéma de base de données
│       └── package.json
├── docker-compose.yml
├── package.json
└── README.md
```

## 🔐 Fonctionnalités Actuelles

### ✅ Implémentées

- [x] Authentification JWT avec refresh tokens
- [x] 2FA (TOTP) avec QR code
- [x] Gestion des utilisateurs (créateurs/abonnés)
- [x] Rate limiting
- [x] Logging structuré
- [x] Base de données PostgreSQL avec Prisma
- [x] Cache Redis
- [x] Validation des données
- [x] Gestion des erreurs globale
- [x] Security headers (Helmet)
- [x] CORS configuré

### 🚧 En développement (TODO)

- [ ] Upload de médias sécurisé (S3/MinIO)
- [ ] Processing vidéo (FFmpeg)
- [ ] Système de paiement complet (Stripe Connect)
- [ ] Abonnements avec renouvellement automatique
- [ ] Messagerie en temps réel (WebSocket)
- [ ] Notifications push
- [ ] KYC/Vérification d'identité
- [ ] Modération de contenu (AI)
- [ ] Analytics avancées
- [ ] Frontend Next.js

## 🧪 Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

## 🛠️ Développement

### Variables d'environnement importantes

Éditez `apps/api/.env` :

```bash
# IMPORTANT: Changez ces secrets en production !
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-jwt-key-change-this-in-production

# Stripe (mode test)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Pour utiliser AWS S3 en production
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# AWS_S3_BUCKET=ofm-content-prod
```

### Commandes utiles

```bash
# Lancer en mode développement avec rechargement auto
npm run dev

# Build pour production
npm run build

# Lancer en production
npm run start:prod

# Générer une migration Prisma
npm run migration:generate -- nom_de_la_migration

# Voir la base de données avec Prisma Studio
cd apps/api
npm run prisma:studio
```

## 🐛 Dépannage

### Erreur : "Cannot connect to database"

```bash
# Vérifier que PostgreSQL est démarré
docker-compose ps

# Relancer les services
docker-compose down
docker-compose up -d

# Attendre 30 secondes, puis retester
```

### Erreur : "Redis connection failed"

```bash
# Vérifier les logs Redis
docker-compose logs redis

# Redémarrer Redis
docker-compose restart redis
```

### Erreur : "Port 3001 already in use"

```bash
# Trouver le processus qui utilise le port
lsof -i :3001

# Tuer le processus
kill -9 <PID>

# Ou changer le port dans apps/api/.env
PORT=3002
```

## 📚 Documentation API

### Endpoints principaux

#### Authentification
- `POST /api/v1/auth/register` - Créer un compte
- `POST /api/v1/auth/login` - Se connecter
- `POST /api/v1/auth/refresh` - Rafraîchir le token
- `POST /api/v1/auth/logout` - Se déconnecter
- `GET /api/v1/auth/me` - Profil actuel

#### 2FA
- `POST /api/v1/auth/2fa/enable` - Activer 2FA
- `POST /api/v1/auth/2fa/verify` - Vérifier code 2FA
- `POST /api/v1/auth/2fa/disable` - Désactiver 2FA

#### Utilisateurs
- `GET /api/v1/users/me` - Mon profil
- `GET /api/v1/users/:username` - Profil public
- `PUT /api/v1/users/profile` - Mettre à jour profil
- `GET /api/v1/users/stats` - Statistiques créateur

#### Abonnements
- `GET /api/v1/subscriptions/my-subscriptions` - Mes abonnements
- `GET /api/v1/subscriptions/my-subscribers` - Mes abonnés
- `GET /api/v1/subscriptions/creator/:id/tiers` - Paliers d'un créateur

#### Contenu
- `GET /api/v1/content/feed` - Feed personnalisé
- `GET /api/v1/content/creator/:id` - Contenu d'un créateur

#### Messages
- `GET /api/v1/messages/conversations` - Liste des conversations
- `GET /api/v1/messages/:partnerId` - Messages avec un utilisateur

#### Notifications
- `GET /api/v1/notifications` - Liste des notifications
- `PUT /api/v1/notifications/:id/read` - Marquer comme lu
- `PUT /api/v1/notifications/read-all` - Tout marquer comme lu

## 🚀 Prochaines étapes

1. **Implémenter l'upload de fichiers** - Voir `docs/MEDIA_UPLOAD.md` (à créer)
2. **Configurer Stripe Connect** - Voir `docs/STRIPE_SETUP.md` (à créer)
3. **Déployer en staging** - Voir `docs/DEPLOYMENT.md` (à créer)

## 💡 Aide

- **Documentation complète** : Voir [README.md](./README.md)
- **Architecture** : Voir [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- **Sécurité** : Voir [docs/SECURITY.md](./docs/SECURITY.md)

## 📝 Notes importantes

⚠️ **Cette configuration est pour le DÉVELOPPEMENT uniquement**

Avant de déployer en production :

1. ✅ Changez TOUS les mots de passe et secrets
2. ✅ Configurez un vrai serveur SMTP (SendGrid, etc.)
3. ✅ Utilisez AWS S3 au lieu de MinIO
4. ✅ Activez HTTPS (Let's Encrypt)
5. ✅ Configurez Sentry pour le monitoring
6. ✅ Mettez en place des backups automatiques
7. ✅ Activez le WAF (Cloudflare)
8. ✅ Passez Stripe en mode production

---

**Développé avec excellence** 🚀 | Version 1.0.0
