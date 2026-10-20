# 🚀 FanVIP - Guide de développement local

Guide complet pour configurer et lancer la plateforme FanVIP en développement local.

---

## 📋 Prérequis

- **Node.js** 20.x ou supérieur
- **npm** 9.x ou supérieur
- **Docker** et **Docker Compose** (pour les services)
- **Git**

---

## ⚡ Tout lancer en une commande

```bash
npm run dev:up        # Windows (cmd / PowerShell), macOS et Linux
```

Le script démarre PostgreSQL, Redis, MinIO et MailDev (Docker), crée `apps/api/.env` et `apps/web/.env.local` s'ils n'existent pas (secrets JWT et clés VAPID générés), crée le bucket MinIO, applique les migrations, **vide la base puis charge les données de démo**, et lance l'API et le front :

| Service | URL |
|---|---|
| Front | http://localhost:3000 |
| API (Swagger) | http://localhost:3001/api/docs |
| E-mails reçus (MailDev) | http://localhost:1080 |
| Stockage (MinIO) | http://localhost:9001 — `minioadmin` / `minioadmin_dev_only` |

Comptes de test (mot de passe `SecurePass123!`) : voir [docs/SEED_ACCOUNTS.md](docs/SEED_ACCOUNTS.md).

- `npm run dev:up -- --keep-db` relance sans toucher aux données.
- Paiements : renseigner les clés Stripe **de test** dans `apps/api/.env` (`STRIPE_SECRET_KEY`) et `apps/web/.env.local` (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).
- Windows : fonctionne directement depuis cmd ou PowerShell (Docker Desktop doit être lancé).
- Le script aligne `apps/api/.env` sur les services Docker (base, Redis, MinIO). Si un autre PostgreSQL occupe déjà le port 5432 sur la machine, le conteneur passe automatiquement sur le port 5433.

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

### Lives (WebRTC) : STUN / TURN

En développement, rien à configurer : `GET /streaming/ice-servers` renvoie les
serveurs STUN publics de Google et la vidéo passe en pair-à-pair sur le réseau
local. En production, ajoutez un relais TURN (coturn) pour les spectateurs
derrière un NAT strict ou un pare-feu d'entreprise :

- `TURN_URLS` - URLs TURN séparées par des virgules, ex.
  `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349`
- `TURN_SECRET` - même valeur que `static-auth-secret` de coturn ; l'API génère
  des identifiants temporaires (6 h), le secret n'est jamais envoyé au navigateur
- `STUN_URLS` (optionnel) - serveurs STUN, séparés par des virgules

Détails et exemple de configuration coturn : `docs/DEPLOYMENT.md`
(« Live streaming: TURN server ») et le service `coturn` commenté de
`docker-compose.prod.yml`.

### Lives : serveur vidéo LiveKit (SFU)

Avec `npm run dev:up`, le conteneur `ofm-livekit` (LiveKit v1.8.4) est lancé
avec les autres services et `apps/api/.env` reçoit :

```
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=fanvip_dev_livekit_secret_change_me_0123456789abcdef
```

Les lives passent alors par LiveKit : la créatrice envoie sa vidéo une seule
fois (3 couches simulcast : 180p, 360p et la qualité choisie) et chaque
spectateur reçoit la couche adaptée à son lecteur et à sa connexion (menu
« Qualité » : Auto / Haute / Moyenne / Basse / Économie de données). Le chat,
les réactions, les pourboires et les objectifs de dons restent sur socket.io.

- Ports publiés : 7880 (signalisation), 7881/tcp et **7882/udp** (média, un seul
  port UDP : les grandes plages UDP sont très lentes sur Docker Desktop).
- LiveKit annonce aux navigateurs l'**IP du PC sur le réseau local** pour la
  vidéo : `npm run dev:up` la détecte et la passe au conteneur (`LIVEKIT_NODE_IP`
  pour la forcer, par exemple si un VPN est actif). Pas 127.0.0.1 : sous Windows,
  Chrome / Edge n'envoient pas la vidéo WebRTC vers l'adresse de bouclage (image
  noire, « Signal OBS reçu, la vidéo arrive… » sans fin). Si Windows demande
  d'autoriser Docker dans le pare-feu, acceptez pour les réseaux privés.
- Tester depuis un téléphone du réseau local : ajouter
  `LIVEKIT_URL=ws://<IP du PC>:7880` dans `apps/api/.env`.
- Vérifier : `docker logs ofm-livekit` (ligne `starting LiveKit server ... nodeIP <IP du PC>`)
  et, sur la page du live, le panneau « Santé du live » indique « Serveur vidéo ».
- Sans Docker (`SKIP_DOCKER=1`) ou en vidant les 3 variables, les lives
  reviennent en pair-à-pair (la créatrice envoie une copie par spectateur,
  adapté à ~10-20 spectateurs).

Production (TLS / wss, ports, TURN intégré, clés, webhook) : `docs/DEPLOYMENT.md`,
« Live streaming: LiveKit SFU ».

### Lives : diffuser avec OBS (LiveKit Ingress)

`npm run dev:up` lance aussi `ofm-livekit-ingress` (LiveKit Ingress v1.4.3,
config `infrastructure/livekit/ingress.dev.yaml`), qui reçoit OBS et publie sa
vidéo dans le live. Ports publiés sur la machine : **8080** (WHIP), **1935**
(RTMP), **7885/udp** (média WHIP). Il partage le réseau du conteneur
`ofm-livekit` et utilise le Redis du docker-compose (obligatoire).

1. Connectez-vous en créatrice (creator@demo.com), menu **Live** → « Diffuser
   avec OBS : réglages et tutoriel » (`/creator/live/obs`).
2. OBS 30+ : Paramètres → Stream → Service « WHIP », Serveur
   `http://localhost:8080/w`, Bearer Token = votre clé. (Ou RTMP : Service
   « Personnalisé… », Serveur `rtmp://localhost:1935/live`, Clé = votre clé.)
3. Sortie : x264/NVENC, 720p ou 1080p, 30 i/s, intervalle d'images clés 2 s,
   B-frames 0 en WHIP ; 4 500-6 000 kbit/s en RTMP.
4. Sur `/creator/live`, source « OBS » → « Lancer le live », puis « Démarrer le
   streaming » dans OBS : le statut passe à « Connexion… » puis « En direct ».

Dépannage : `docker logs ofm-livekit-ingress` ; « Le service de réception OBS
ne répond pas » = Ingress ou Redis arrêté ; port 8080 déjà pris sous Windows →
libérez-le (ou changez `whip_port` + le port publié + `ingress.whip_base_url`).

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
