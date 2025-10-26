# 🚀 OFM Platform - Guide de développement local

Guide complet pour configurer et lancer la plateforme OFM en développement local.

---

## 📋 Prérequis

- **Node.js** 20.x ou supérieur
- **npm** 9.x ou supérieur
- **Docker** et **Docker Compose** (pour les services)
- **Git**

---

## 🔧 Installation rapide

### 1. Services avec Docker (Recommandé)

Démarrez tous les services nécessaires en une commande :

```bash
# Démarrer PostgreSQL, Redis, MinIO et MailDev
docker-compose -f docker-compose.dev.yml up -d

# Vérifier que tout est lancé
docker-compose -f docker-compose.dev.yml ps
```

Services disponibles :
- **PostgreSQL** : `localhost:5432` (DB: ofm_db, User: ofm_user, Pass: ofm_password_dev_only)
- **Redis** : `localhost:6379` (Pass: redis_password_dev_only)
- **MinIO** : `localhost:9000` (API) / `localhost:9001` (Console UI)
- **MailDev** : `localhost:1025` (SMTP) / `localhost:1080` (Web UI)

### 2. Installation des dépendances

```bash
# Installer toutes les dépendances du monorepo
npm install

# Générer le client Prisma
cd apps/api
npm run prisma:generate
```

### 3. Configuration de la base de données

```bash
cd apps/api

# Créer les tables (migration)
npx prisma migrate dev

# (Optionnel) Remplir avec des données de test
npm run seed
```

### 4. Créer le bucket MinIO

Ouvrez http://localhost:9001 dans votre navigateur :
- **Login** : minioadmin
- **Password** : minioadmin_dev_only
- Créez un bucket nommé **`ofm-content-dev`**
- Définissez la politique d'accès : **Public** (pour le dev)

### 5. Démarrer le projet

```bash
# Retourner à la racine
cd ../..

# Démarrer l'API (backend) et le Web (frontend) en parallèle
npm run dev
```

URLs de développement :
- **Frontend** : http://localhost:3000
- **Backend API** : http://localhost:3001
- **API Docs** : http://localhost:3001/api/v1/docs

---

## 🪟 Setup Windows

Si vous êtes sur **Windows**, utilisez les scripts PowerShell :

```powershell
# 1. Démarrer les services Docker
docker-compose -f docker-compose.dev.yml up -d

# 2. Installer les dépendances
npm install

# 3. Configurer la base de données
cd apps/api
npx prisma migrate dev

# 4. Utiliser le script Windows pour démarrer l'API
.\dev-windows.ps1
```

Le script `dev-windows.ps1` va :
- ✅ Nettoyer le cache webpack
- ✅ Régénérer le client Prisma
- ✅ Démarrer le serveur de dev

---

## 🔑 Variables d'environnement

Le fichier `.env` a été créé automatiquement dans `apps/api/.env` avec les valeurs de développement.

**Variables importantes à modifier en production** :
- `JWT_SECRET` - Clé secrète JWT
- `STRIPE_SECRET_KEY` - Clé Stripe (obtenir sur https://stripe.com)
- `DATABASE_URL` - URL de votre base de données de production

---

## 🧪 Tests

```bash
# Tests unitaires de l'API
cd apps/api
npm run test

# Tests E2E
npm run test:e2e

# Coverage
npm run test:cov
```

---

## 🐳 Commandes Docker utiles

```bash
# Arrêter tous les services
docker-compose -f docker-compose.dev.yml down

# Arrêter et supprimer les volumes (réinitialisation complète)
docker-compose -f docker-compose.dev.yml down -v

# Voir les logs
docker-compose -f docker-compose.dev.yml logs -f

# Logs d'un service spécifique
docker-compose -f docker-compose.dev.yml logs -f postgres
```

---

## 🗄️ Base de données

```bash
cd apps/api

# Voir le statut des migrations
npx prisma migrate status

# Créer une nouvelle migration
npx prisma migrate dev --name nom_de_la_migration

# Ouvrir Prisma Studio (UI pour la DB)
npm run prisma:studio
```

---

## 📧 Emails en développement

Les emails sont capturés par **MailDev** :
- Interface Web : http://localhost:1080
- Tous les emails envoyés par l'app apparaissent ici

---

## 🔍 Debugging

### Backend ne démarre pas

1. **Vérifier que les services Docker sont lancés** :
   ```bash
   docker-compose -f docker-compose.dev.yml ps
   ```

2. **Vérifier la connexion PostgreSQL** :
   ```bash
   docker-compose -f docker-compose.dev.yml logs postgres
   ```

3. **Régénérer Prisma** :
   ```bash
   cd apps/api
   npx prisma generate
   ```

### Frontend ne se connecte pas à l'API

1. **Vérifier que l'API écoute sur le port 3001** :
   ```bash
   curl http://localhost:3001/api/v1/health
   ```

2. **Vérifier les logs de l'API** dans le terminal

### Erreurs Prisma

```bash
cd apps/api

# Réinitialiser complètement la DB
npx prisma migrate reset

# Regénérer le client
npx prisma generate
```

---

## 🏗️ Structure du projet

```
ofm/
├── apps/
│   ├── api/          # Backend NestJS
│   └── web/          # Frontend Next.js
├── packages/         # Packages partagés
├── infrastructure/   # Terraform pour le déploiement
├── docker-compose.dev.yml  # Services de dev
└── DEV_SETUP.md     # Ce fichier
```

---

## 🆘 Besoin d'aide ?

- **Documentation API** : http://localhost:3001/api/v1/docs
- **Prisma Studio** : `npm run prisma:studio` dans `apps/api`
- **MinIO Console** : http://localhost:9001
- **MailDev** : http://localhost:1080

---

## 🚀 Prêt à développer !

Une fois tout configuré, vous pouvez :
1. **Créer un compte** via le frontend (http://localhost:3000/register)
2. **Tester l'API** via Swagger (http://localhost:3001/api/v1/docs)
3. **Voir les emails** dans MailDev (http://localhost:1080)
4. **Explorer la DB** avec Prisma Studio (`npm run prisma:studio`)

Bon développement ! 💻
