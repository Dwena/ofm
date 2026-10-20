#!/usr/bin/env node
//
// Lance toute la plateforme en local, prête à tester (Windows, macOS, Linux) :
//   PostgreSQL, Redis, MinIO, MailDev (docker-compose.dev.yml)
//   + fichiers .env, migrations, données de démo, API (:3001) et front (:3000)
//
//   npm run dev:up                 tout lancer (la base est vidée puis reseedée)
//   npm run dev:up -- --keep-db    garder les données existantes (pas de reseed)
//
// Variables utiles :
//   SKIP_DOCKER=1   utiliser des services déjà lancés (fournir DATABASE_URL, REDIS_*)
//   STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   clés Stripe de test
//   SEED_STRIPE_ACCOUNT_ID   compte Connect de test attribué à la créatrice Alice
//
// Comptes de démo : docs/SEED_ACCOUNTS.md (mot de passe SecurePass123!)

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = join(ROOT, 'apps', 'api');
const WEB_DIR = join(ROOT, 'apps', 'web');
const IS_WINDOWS = process.platform === 'win32';

let keepDb = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--keep-db') keepDb = true;
  else if (arg === '-h' || arg === '--help') {
    const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16);
    console.log(header.map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  } else fail(`Option inconnue : ${arg}`);
}

function step(message) {
  console.log(`\n\x1b[1;34m▶ ${message}\x1b[0m`);
}

function fail(message) {
  console.error(`\x1b[1;31m✖ ${message}\x1b[0m`);
  process.exit(1);
}

// Commands go through the shell so that npx / npm resolve to their .cmd shims
// on Windows; arguments never contain user paths (cwd is passed separately).
function run(command, { cwd = ROOT, env = {}, quiet = false } = {}) {
  const result = spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: quiet ? 'ignore' : 'inherit',
  });
  return result.status === 0;
}

function runOrFail(command, options, errorMessage) {
  if (!run(command, options)) fail(errorMessage ?? `Échec de la commande : ${command}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPostgres() {
  process.stdout.write('Attente de PostgreSQL');
  const ready = () => run('docker exec ofm-postgres pg_isready -U ofm_user -d ofm_db', { quiet: true });
  for (let i = 0; i < 60; i++) {
    if (ready()) {
      // pg_isready answers during the image's init restart: give it a moment
      await sleep(1000);
      console.log(' OK');
      return;
    }
    process.stdout.write('.');
    await sleep(1000);
  }
  fail('PostgreSQL ne répond pas (docker logs ofm-postgres)');
}

// Real login from the host, through the published port
function canConnect(databaseUrl) {
  const result = spawnSync(`npx prisma db execute --url "${databaseUrl}" --stdin`, {
    cwd: API_DIR,
    shell: true,
    input: 'SELECT 1;',
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

const API_ENV_PATH = join(API_DIR, '.env');

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^[ \t]*([A-Z0-9_]+)[ \t]*=[ \t]*(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return values;
}

// Replace (or append) KEY=value lines, keeping the rest of the file as is
function updateEnvFile(path, values) {
  const current = readEnvFile(path);
  let content = readFileSync(path, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    if (current[key] === value) continue;
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
    content = pattern.test(content) ? content.replace(pattern, () => line) : `${content.replace(/\s*$/, '')}\n${line}\n`;
    console.log(`apps/api/.env : ${key} mis à jour pour les services Docker`);
  }
  writeFileSync(path, content);
}

function dockerPortFromEnvFile() {
  const url = readEnvFile(API_ENV_PATH).DATABASE_URL || '';
  return url.match(/^postgresql:\/\/ofm_user:ofm_password_dev_only@localhost:(\d+)\/ofm_db$/)?.[1];
}

// Values matching docker-compose.dev.yml
const PG_PASSWORD = 'ofm_password_dev_only';
const dockerDatabaseUrl = (port) => `postgresql://ofm_user:${PG_PASSWORD}@localhost:${port}/ofm_db`;
let DATABASE_URL = process.env.DATABASE_URL || dockerDatabaseUrl(5432);
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || '6379';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? 'redis_password_dev_only';
const S3_ENDPOINT = process.env.AWS_S3_ENDPOINT || 'http://localhost:9000';
const SKIP_DOCKER = process.env.SKIP_DOCKER === '1';
// With Docker, always the MinIO credentials (ignore any real AWS keys in the shell)
const S3_ACCESS_KEY = (SKIP_DOCKER && process.env.AWS_ACCESS_KEY_ID) || 'minioadmin';
const S3_SECRET_KEY = (SKIP_DOCKER && process.env.AWS_SECRET_ACCESS_KEY) || 'minioadmin_dev_only';
const S3_BUCKET = process.env.AWS_S3_BUCKET || 'ofm-content-dev';
const API_URL = 'http://localhost:3001';
const WEB_URL = 'http://localhost:3000';

// ---------- Prerequisites ----------
step('Vérification des prérequis');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) fail(`Node.js 20+ requis (version actuelle : ${process.version})`);
console.log(`Node ${process.version}`);

// ---------- Dependencies ----------
if (!existsSync(join(ROOT, 'node_modules', '.bin'))) {
  step('Installation des dépendances (npm install)');
  runOrFail('npm install', {}, 'npm install a échoué');
}

if (!SKIP_DOCKER) {
  if (!run('docker --version', { quiet: true })) {
    fail('Docker requis (https://docs.docker.com/get-docker/), ou SKIP_DOCKER=1 avec vos propres services');
  }
  if (!run('docker info', { quiet: true })) fail('Docker est installé mais ne tourne pas : lancez Docker Desktop');
  const compose = run('docker compose version', { quiet: true }) ? 'docker compose' : 'docker-compose';

  // ---------- Services ----------
  step('Démarrage de PostgreSQL, Redis, MinIO et MailDev');
  // Reuse the port chosen on a previous run (5433 when 5432 is taken by another Postgres)
  let pgPort = process.env.POSTGRES_PORT || dockerPortFromEnvFile() || '5432';
  const composeUp = () =>
    runOrFail(
      `${compose} -f docker-compose.dev.yml up -d`,
      { env: { POSTGRES_PORT: pgPort } },
      'Impossible de démarrer les conteneurs Docker',
    );
  composeUp();
  await waitForPostgres();

  // A volume created by an older setup may hold another password: the
  // container trusts local connections, so reset it to the expected one.
  if (!run(`docker exec ofm-postgres psql -U ofm_user -d postgres -c "ALTER ROLE ofm_user WITH PASSWORD '${PG_PASSWORD}'"`, { quiet: true })) {
    fail(
      "Le volume Docker de PostgreSQL vient d'une ancienne configuration (utilisateur ofm_user absent).\n" +
        '  Supprimez-le puis relancez :  docker compose -f docker-compose.dev.yml down -v  &&  npm run dev:up',
    );
  }

  // The container accepts the password but the host does not: another
  // PostgreSQL (installed on Windows/macOS) answers on that port.
  if (!canConnect(dockerDatabaseUrl(pgPort))) {
    if (pgPort !== '5432') fail(`Connexion à PostgreSQL impossible sur le port ${pgPort} (docker logs ofm-postgres)`);
    console.log('Un autre PostgreSQL occupe déjà le port 5432 sur cette machine : passage du conteneur sur le port 5433');
    pgPort = '5433';
    composeUp();
    await waitForPostgres();
    if (!canConnect(dockerDatabaseUrl(pgPort))) fail('Connexion à PostgreSQL impossible sur le port 5433 (docker logs ofm-postgres)');
  }
  DATABASE_URL = dockerDatabaseUrl(pgPort);
  console.log(`PostgreSQL prêt sur localhost:${pgPort}`);
}

const apiRequire = createRequire(join(API_DIR, 'package.json'));

// ---------- Env files ----------
const secret = () => randomBytes(32).toString('hex');

const apiEnvPath = API_ENV_PATH;
if (!existsSync(apiEnvPath)) {
  step('Création de apps/api/.env');
  let vapid = { publicKey: '', privateKey: '' };
  try {
    vapid = apiRequire('web-push').generateVAPIDKeys();
  } catch {
    console.log('web-push introuvable : clés VAPID laissées vides (notifications push désactivées)');
  }
  writeFileSync(
    apiEnvPath,
    `# Généré par scripts/dev-up.mjs — environnement de développement local
NODE_ENV=development
PORT=3001
API_PREFIX=api/v1
APP_URL=${API_URL}
WEB_URL=${WEB_URL}
FRONTEND_URL=${WEB_URL}
CORS_ORIGINS=${WEB_URL}

DATABASE_URL=${DATABASE_URL}

REDIS_HOST=${REDIS_HOST}
REDIS_PORT=${REDIS_PORT}
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_DB=0

JWT_SECRET=${secret()}
JWT_REFRESH_SECRET=${secret()}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Large enough for a single developer clicking around + e2e tests
THROTTLE_TTL=60
THROTTLE_LIMIT=1000

# Stripe (mode test) : https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=${process.env.STRIPE_SECRET_KEY || 'sk_test_remplacez_moi'}
STRIPE_WEBHOOK_SECRET=${process.env.STRIPE_WEBHOOK_SECRET || 'whsec_remplacez_moi'}
STRIPE_PLATFORM_FEE_PERCENTAGE=15

# Stockage MinIO (console : http://localhost:9001)
AWS_S3_ENDPOINT=${S3_ENDPOINT}
AWS_S3_FORCE_PATH_STYLE=true
AWS_S3_BUCKET=${S3_BUCKET}
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=${S3_ACCESS_KEY}
AWS_SECRET_ACCESS_KEY=${S3_SECRET_KEY}

# E-mails capturés par MailDev : http://localhost:1080
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=noreply@ofm.local
SMTP_FROM_NAME=FanVIP

# Notifications push (clés générées automatiquement)
VAPID_PUBLIC_KEY=${vapid.publicKey}
VAPID_PRIVATE_KEY=${vapid.privateKey}
VAPID_SUBJECT=mailto:admin@ofm.local

STREAM_BASE_URL=${API_URL}
`,
  );
} else if (SKIP_DOCKER) {
  console.log('apps/api/.env existe déjà : conservé');
} else {
  console.log('apps/api/.env existe déjà : conservé (connexions alignées sur les services Docker)');
  updateEnvFile(apiEnvPath, {
    DATABASE_URL,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASSWORD,
    AWS_S3_ENDPOINT: S3_ENDPOINT,
    AWS_S3_FORCE_PATH_STYLE: 'true',
    AWS_S3_BUCKET: S3_BUCKET,
    AWS_ACCESS_KEY_ID: S3_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: S3_SECRET_KEY,
  });
}

const webEnvPath = join(WEB_DIR, '.env.local');
if (!existsSync(webEnvPath)) {
  step('Création de apps/web/.env.local');
  writeFileSync(
    webEnvPath,
    `# Généré par scripts/dev-up.mjs
NEXT_PUBLIC_API_URL=${API_URL}
NEXT_PUBLIC_WS_URL=${API_URL}
NEXT_PUBLIC_APP_URL=${WEB_URL}
NEXT_PUBLIC_APP_NAME=FanVIP
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_remplacez_moi'}
NEXT_PUBLIC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
`,
  );
} else {
  console.log('apps/web/.env.local existe déjà : conservé');
}

// ---------- Storage bucket ----------
if (!SKIP_DOCKER) {
  step(`Création du bucket MinIO « ${S3_BUCKET} »`);
  const { S3Client, CreateBucketCommand, HeadBucketCommand } = apiRequire('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  });
  let done = false;
  for (let i = 0; i < 30 && !done; i++) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
      console.log('déjà présent');
      done = true;
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) {
        await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
        console.log('créé');
        done = true;
      } else {
        await sleep(1000);
      }
    }
  }
  if (!done) fail('MinIO ne répond pas (docker logs ofm-minio)');
}

// ---------- Database ----------
const dbEnv = { DATABASE_URL };
step('Migrations de la base');
runOrFail('npx prisma generate', { cwd: API_DIR, env: dbEnv }, 'prisma generate a échoué');
runOrFail('npx prisma migrate deploy', { cwd: API_DIR, env: dbEnv }, 'Les migrations ont échoué');

if (keepDb) {
  console.log('--keep-db : données existantes conservées');
} else {
  step('Données de démo (base vidée puis reseedée)');
  runOrFail('npx ts-node prisma/seed.ts', { cwd: API_DIR, env: { ...dbEnv, SEED_RESET: 'true' } }, 'Le seed a échoué');
}

// ---------- Run ----------
step("Démarrage de l'API et du front");
console.log(`
  Front      ${WEB_URL}
  API        ${API_URL}/api/v1   (docs Swagger : ${API_URL}/api/docs)
  E-mails    http://localhost:1080   (MailDev)
  Stockage   http://localhost:9001   (MinIO : minioadmin / minioadmin_dev_only)

  Comptes : docs/SEED_ACCOUNTS.md — mot de passe SecurePass123!
  Ctrl+C pour arrêter l'API et le front ; les services Docker restent lancés
  (arrêt : docker compose -f docker-compose.dev.yml down)
`);

const dev = spawn('npx turbo run dev --filter=@ofm/api --filter=@ofm/web', {
  cwd: ROOT,
  shell: true,
  stdio: 'inherit',
});
// Ctrl+C reaches turbo directly through the shared console; just mirror its exit
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => IS_WINDOWS || dev.kill(signal));
dev.on('exit', (code) => process.exit(code ?? 0));
