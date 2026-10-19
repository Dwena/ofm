#!/usr/bin/env bash
#
# Lance toute la plateforme en local, prête à tester :
#   PostgreSQL, Redis, MinIO, MailDev (docker-compose.dev.yml)
#   + fichiers .env, migrations, données de démo, API (:3001) et front (:3000)
#
#   ./scripts/dev-up.sh             tout lancer (la base est vidée puis reseedée)
#   ./scripts/dev-up.sh --keep-db   garder les données existantes (pas de reseed)
#
# Variables utiles :
#   SKIP_DOCKER=1   utiliser des services déjà lancés (fournir DATABASE_URL, REDIS_*)
#   STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   clés Stripe de test
#   SEED_STRIPE_ACCOUNT_ID   compte Connect de test attribué à la créatrice Alice
#
# Comptes de démo : docs/SEED_ACCOUNTS.md (mot de passe SecurePass123!)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

KEEP_DB=0
for arg in "$@"; do
  case "$arg" in
    --keep-db) KEEP_DB=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

# Values matching docker-compose.dev.yml
DATABASE_URL="${DATABASE_URL:-postgresql://ofm_user:ofm_password_dev_only@localhost:5432/ofm_db}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_PASSWORD="${REDIS_PASSWORD-redis_password_dev_only}"
S3_ENDPOINT="${AWS_S3_ENDPOINT:-http://localhost:9000}"
S3_ACCESS_KEY="${AWS_ACCESS_KEY_ID:-minioadmin}"
S3_SECRET_KEY="${AWS_SECRET_ACCESS_KEY:-minioadmin_dev_only}"
S3_BUCKET="${AWS_S3_BUCKET:-ofm-content-dev}"
API_URL="http://localhost:3001"
WEB_URL="http://localhost:3000"

# ---------- Prerequisites ----------
step "Vérification des prérequis"
command -v node >/dev/null || fail "Node.js 20+ requis (https://nodejs.org)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20+ requis (version actuelle : $(node -v))"
echo "Node $(node -v)"

if [ "${SKIP_DOCKER:-0}" != "1" ]; then
  command -v docker >/dev/null || fail "Docker requis (https://docs.docker.com/get-docker/), ou SKIP_DOCKER=1 avec vos propres services"
  docker info >/dev/null 2>&1 || fail "Docker est installé mais ne tourne pas : lancez Docker Desktop"
  if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi

  # ---------- Services ----------
  step "Démarrage de PostgreSQL, Redis, MinIO et MailDev"
  "${COMPOSE[@]}" -f docker-compose.dev.yml up -d

  printf 'Attente de PostgreSQL'
  for _ in $(seq 1 60); do
    if docker exec ofm-postgres pg_isready -U ofm_user -d ofm_db >/dev/null 2>&1; then break; fi
    printf '.'; sleep 1
  done
  docker exec ofm-postgres pg_isready -U ofm_user -d ofm_db >/dev/null 2>&1 || fail "PostgreSQL ne répond pas (docker logs ofm-postgres)"
  echo ' OK'
fi

# ---------- Dependencies ----------
if [ ! -d node_modules ] || [ ! -d node_modules/.bin ]; then
  step "Installation des dépendances (npm install)"
  npm install
fi

# ---------- Env files ----------
random_secret() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }

if [ ! -f apps/api/.env ]; then
  step "Création de apps/api/.env"
  VAPID_JSON="$(cd apps/api && node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))" 2>/dev/null || echo '{}')"
  VAPID_PUBLIC="$(node -e "console.log(JSON.parse(process.argv[1]).publicKey||'')" "$VAPID_JSON")"
  VAPID_PRIVATE="$(node -e "console.log(JSON.parse(process.argv[1]).privateKey||'')" "$VAPID_JSON")"
  cat > apps/api/.env <<EOF
# Généré par scripts/dev-up.sh — environnement de développement local
NODE_ENV=development
PORT=3001
API_PREFIX=api/v1
APP_URL=$API_URL
WEB_URL=$WEB_URL
FRONTEND_URL=$WEB_URL
CORS_ORIGINS=$WEB_URL

DATABASE_URL=$DATABASE_URL

REDIS_HOST=$REDIS_HOST
REDIS_PORT=$REDIS_PORT
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_DB=0

JWT_SECRET=$(random_secret)
JWT_REFRESH_SECRET=$(random_secret)
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Large enough for a single developer clicking around + e2e tests
THROTTLE_TTL=60
THROTTLE_LIMIT=1000

# Stripe (mode test) : https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-sk_test_remplacez_moi}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-whsec_remplacez_moi}
STRIPE_PLATFORM_FEE_PERCENTAGE=15

# Stockage MinIO (console : http://localhost:9001)
AWS_S3_ENDPOINT=$S3_ENDPOINT
AWS_S3_FORCE_PATH_STYLE=true
AWS_S3_BUCKET=$S3_BUCKET
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=$S3_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=$S3_SECRET_KEY

# E-mails capturés par MailDev : http://localhost:1080
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=noreply@ofm.local
SMTP_FROM_NAME=OFM

# Notifications push (clés générées automatiquement)
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
VAPID_SUBJECT=mailto:admin@ofm.local

STREAM_BASE_URL=$API_URL
EOF
else
  echo "apps/api/.env existe déjà : conservé"
fi

if [ ! -f apps/web/.env.local ]; then
  step "Création de apps/web/.env.local"
  cat > apps/web/.env.local <<EOF
# Généré par scripts/dev-up.sh
NEXT_PUBLIC_API_URL=$API_URL
NEXT_PUBLIC_WS_URL=$API_URL
NEXT_PUBLIC_APP_URL=$WEB_URL
NEXT_PUBLIC_APP_NAME=OFM
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-pk_test_remplacez_moi}
NEXT_PUBLIC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
EOF
else
  echo "apps/web/.env.local existe déjà : conservé"
fi

# ---------- Storage bucket ----------
if [ "${SKIP_DOCKER:-0}" != "1" ]; then
  step "Création du bucket MinIO « $S3_BUCKET »"
  (cd apps/api && node -e "
    const { S3Client, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({ endpoint: '$S3_ENDPOINT', region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: '$S3_ACCESS_KEY', secretAccessKey: '$S3_SECRET_KEY' } });
    (async () => {
      for (let i = 0; i < 30; i++) {
        try { await s3.send(new HeadBucketCommand({ Bucket: '$S3_BUCKET' })); return console.log('déjà présent'); }
        catch (e) {
          if (e.\$metadata?.httpStatusCode === 404) { await s3.send(new CreateBucketCommand({ Bucket: '$S3_BUCKET' })); return console.log('créé'); }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      throw new Error('MinIO ne répond pas (docker logs ofm-minio)');
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ")
fi

# ---------- Database ----------
step "Migrations de la base"
(cd apps/api && npx prisma generate >/dev/null && DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy)

if [ "$KEEP_DB" = "1" ]; then
  echo "--keep-db : données existantes conservées"
else
  step "Données de démo (base vidée puis reseedée)"
  (cd apps/api && DATABASE_URL="$DATABASE_URL" SEED_RESET=true npx ts-node prisma/seed.ts)
fi

# ---------- Run ----------
step "Démarrage de l'API et du front"
cat <<EOF

  Front      $WEB_URL
  API        $API_URL/api/v1   (docs Swagger : $API_URL/api/docs)
  E-mails    http://localhost:1080   (MailDev)
  Stockage   http://localhost:9001   (MinIO : minioadmin / minioadmin_dev_only)

  Comptes : docs/SEED_ACCOUNTS.md — mot de passe SecurePass123!
  Ctrl+C pour arrêter l'API et le front ; les services Docker restent lancés
  (arrêt : docker compose -f docker-compose.dev.yml down)

EOF

exec npx turbo run dev --filter=@ofm/api --filter=@ofm/web
