#!/usr/bin/env node
//
// Lance toute la plateforme en local, prête à tester (Windows, macOS, Linux) :
//   PostgreSQL, Redis, MinIO, MailDev, LiveKit + LiveKit Ingress (OBS) (docker-compose.dev.yml)
//   + fichiers .env, migrations, données de démo, API (:3001) et front (:3000)
//
//   npm run dev:up                 tout lancer (la base est vidée puis reseedée)
//   npm run dev:up -- --keep-db    garder les données existantes (pas de reseed)
//
// Variables utiles :
//   SKIP_DOCKER=1   utiliser des services déjà lancés (fournir DATABASE_URL, REDIS_*) ;
//                   lives en pair-à-pair sauf si LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET sont fournis
//   STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   clés Stripe de test
//   SEED_STRIPE_ACCOUNT_ID   compte Connect de test attribué à la créatrice Alice
//
// Comptes de démo : docs/SEED_ACCOUNTS.md (mot de passe SecurePass123!)

import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// ---------- Native LiveKit (Windows) ----------
const LIVEKIT_VERSION = '1.8.4';
const LIVEKIT_ASSETS = {
  win32: { file: `livekit_${LIVEKIT_VERSION}_windows_amd64.zip`, exe: 'livekit-server.exe' },
  linux: { file: `livekit_${LIVEKIT_VERSION}_linux_amd64.tar.gz`, exe: 'livekit-server' },
};

// Downloads the official livekit-server release once into .cache/livekit/<version>
async function ensureLivekitBinary() {
  const asset = LIVEKIT_ASSETS[process.platform];
  if (!asset) fail(`LiveKit natif non disponible sur ${process.platform} : utilisez LIVEKIT_MODE=docker`);
  const dir = join(ROOT, '.cache', 'livekit', LIVEKIT_VERSION);
  const exe = join(dir, asset.exe);
  if (existsSync(exe)) return exe;

  mkdirSync(dir, { recursive: true });
  const archive = join(dir, asset.file);
  const url = `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${asset.file}`;
  console.log(`Téléchargement de LiveKit ${LIVEKIT_VERSION} (${url})`);
  const response = await fetch(url);
  if (!response.ok || !response.body) fail(`Téléchargement de LiveKit impossible (HTTP ${response.status})`);
  await new Promise((resolve, reject) => {
    const out = createWriteStream(archive);
    const reader = response.body.getReader();
    const pump = () =>
      reader.read().then(({ done, value }) => {
        if (done) return out.end(resolve);
        out.write(Buffer.from(value), (error) => (error ? reject(error) : pump()));
      }, reject);
    pump();
  });
  // bsdtar ships with Windows 10+ and reads zip archives too
  const extracted =
    spawnSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' }).status === 0 ||
    (IS_WINDOWS &&
      spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${dir}'`],
        { stdio: 'inherit' },
      ).status === 0);
  rmSync(archive, { force: true });
  if (!extracted || !existsSync(exe)) fail(`Extraction de LiveKit impossible dans ${dir}`);
  return exe;
}

async function livekitResponds() {
  try {
    const response = await fetch('http://127.0.0.1:7880', { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

// Starts livekit-server as a child of this script (stopped with it). Returns null
// when a LiveKit already answers on 7880 (left running by a previous dev:up).
async function startNativeLivekit(nodeIp) {
  if (await livekitResponds()) {
    console.log('LiveKit répond déjà sur le port 7880 : réutilisé');
    return null;
  }
  const exe = await ensureLivekitBinary();
  const logPath = join(ROOT, '.cache', 'livekit', 'livekit.log');
  const log = openSync(logPath, 'a');
  const child = spawn(
    exe,
    ['--config', join(ROOT, 'infrastructure', 'livekit', 'livekit.native.yaml'), '--node-ip', nodeIp],
    { cwd: ROOT, stdio: ['ignore', log, log], windowsHide: true },
  );
  child.on('exit', (code) => {
    if (code) console.error(`\x1b[1;31m✖ LiveKit s'est arrêté (code ${code}) : voir ${logPath}\x1b[0m`);
  });
  for (let i = 0; i < 40; i++) {
    if (await livekitResponds()) {
      console.log(`LiveKit natif lancé (journal : ${logPath})`);
      return child;
    }
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  fail(`LiveKit ne démarre pas : voir ${logPath}`);
}

// IPv4 of the interface that routes to the internet (no packet is sent: a UDP
// "connect" only picks the route). Falls back to the first private address of a
// physical-looking interface, skipping Docker / WSL / Hyper-V / VPN adapters.
async function detectLanIp() {
  const routed = await new Promise((resolve) => {
    const socket = createSocket('udp4');
    const done = (ip) => {
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(ip);
    };
    socket.on('error', () => done(null));
    try {
      socket.connect(53, '1.1.1.1', () => {
        try {
          done(socket.address().address);
        } catch {
          done(null);
        }
      });
    } catch {
      done(null);
    }
    setTimeout(() => done(null), 1000);
  });
  if (routed && routed !== '0.0.0.0' && !routed.startsWith('127.')) return routed;

  const virtual = /docker|wsl|vethernet|hyper-v|virtualbox|vmware|vbox|loopback|tailscale|zerotier|utun|tun|tap/i;
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (virtual.test(name)) continue;
    const ipv4 = (addresses ?? []).find((a) => a.family === 'IPv4' && !a.internal);
    if (ipv4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ipv4.address)) return ipv4.address;
  }
  return null;
}

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
// LiveKit (lives) : keys of infrastructure/livekit/livekit.dev.yaml. Without
// Docker, only what the shell provides (nothing: peer-to-peer lives).
const LIVEKIT_DEV = {
  LIVEKIT_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'fanvip_dev_livekit_secret_change_me_0123456789abcdef',
  // "Diffuser avec OBS" : URLs publiques du conteneur ofm-livekit-ingress
  LIVEKIT_INGRESS_RTMP_URL: 'rtmp://localhost:1935/live',
  LIVEKIT_INGRESS_WHIP_URL: 'http://localhost:8080/w',
};
const LIVEKIT_ENV = SKIP_DOCKER
  ? Object.fromEntries(
      Object.keys(LIVEKIT_DEV)
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    )
  : LIVEKIT_DEV;
const API_URL = 'http://localhost:3001';
const WEB_URL = 'http://localhost:3000';

// ---------- Prerequisites ----------
step('Vérification des prérequis');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) fail(`Node.js 20+ requis (version actuelle : ${process.version})`);
console.log(`Node ${process.version}`);

// ---------- Dependencies ----------
// Reinstall when package-lock.json changed since the last install (after a git pull
// that adds dependencies), not only when node_modules is missing
const LOCK_HASH_PATH = join(ROOT, 'node_modules', '.ofm-lock-hash');
const lockHash = createHash('sha1').update(readFileSync(join(ROOT, 'package-lock.json'))).digest('hex');
const installedHash = existsSync(LOCK_HASH_PATH) ? readFileSync(LOCK_HASH_PATH, 'utf8').trim() : null;
if (!existsSync(join(ROOT, 'node_modules', '.bin')) || installedHash !== lockHash) {
  step('Installation des dépendances (npm install)');
  runOrFail('npm install', {}, 'npm install a échoué');
  writeFileSync(LOCK_HASH_PATH, lockHash);
}

let nativeLivekit = null;
if (!SKIP_DOCKER) {
  if (!run('docker --version', { quiet: true })) {
    fail('Docker requis (https://docs.docker.com/get-docker/), ou SKIP_DOCKER=1 avec vos propres services');
  }
  if (!run('docker info', { quiet: true })) fail('Docker est installé mais ne tourne pas : lancez Docker Desktop');
  const compose = run('docker compose version', { quiet: true }) ? 'docker compose' : 'docker-compose';

  // ---------- Services ----------
  step('Démarrage de PostgreSQL, Redis, MinIO, MailDev et LiveKit');
  // Reuse the port chosen on a previous run (5433 when 5432 is taken by another Postgres)
  let pgPort = process.env.POSTGRES_PORT || dockerPortFromEnvFile() || '5432';
  // Address LiveKit advertises to browsers for the video (WebRTC). Not 127.0.0.1:
  // on Windows, Chrome / Edge never send media to the loopback address, so the
  // video stayed black. The PC's LAN IP reaches the ports Docker publishes.
  const livekitNodeIp = process.env.LIVEKIT_NODE_IP || (await detectLanIp()) || '127.0.0.1';
  console.log(`Adresse annoncée par LiveKit pour la vidéo : ${livekitNodeIp}`);
  // Windows: LiveKit as a native process (Docker Desktop drops the browsers'
  // WebRTC UDP), only its OBS ingress in Docker. Elsewhere: both in Docker.
  const livekitMode = process.env.LIVEKIT_MODE || (IS_WINDOWS ? 'native' : 'docker');
  const composeEnv = { POSTGRES_PORT: pgPort, LIVEKIT_NODE_IP: livekitNodeIp };
  const composeUp = () =>
    runOrFail(
      `${compose} -f docker-compose.dev.yml --profile livekit-${livekitMode} up -d`,
      { env: { ...composeEnv, POSTGRES_PORT: pgPort } },
      'Impossible de démarrer les conteneurs Docker',
    );
  if (livekitMode === 'native') {
    // Containers of the Docker mode would hold ports 7880-7882 / the ingress name
    run('docker rm -f ofm-livekit ofm-livekit-ingress', { quiet: true });
  }
  composeUp();
  if (livekitMode === 'docker') {
    // The ingress shares the network of the livekit container: recreate it so
    // it follows a livekit container recreated for a new NODE_IP
    run(`${compose} -f docker-compose.dev.yml --profile livekit-docker up -d --force-recreate --no-deps livekit-ingress`, {
      env: composeEnv,
      quiet: true,
    });
  } else {
    // After compose: LiveKit needs the Redis container to answer
    for (let i = 0; i < 30; i++) {
      if (run(`docker exec ofm-redis redis-cli -a ${REDIS_PASSWORD} --no-auth-warning ping`, { quiet: true })) break;
      await sleep(500);
    }
    nativeLivekit = await startNativeLivekit(livekitNodeIp);
    run(`${compose} -f docker-compose.dev.yml --profile livekit-native up -d --force-recreate --no-deps livekit-ingress-native`, {
      env: composeEnv,
      quiet: true,
    });
  }
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

# Lives : serveur vidéo LiveKit (conteneur ofm-livekit). Vides = pair-à-pair.
LIVEKIT_URL=${LIVEKIT_ENV.LIVEKIT_URL ?? ''}
LIVEKIT_API_KEY=${LIVEKIT_ENV.LIVEKIT_API_KEY ?? ''}
LIVEKIT_API_SECRET=${LIVEKIT_ENV.LIVEKIT_API_SECRET ?? ''}
# Diffuser avec OBS (conteneur ofm-livekit-ingress) : URLs à coller dans OBS
LIVEKIT_INGRESS_RTMP_URL=${LIVEKIT_ENV.LIVEKIT_INGRESS_RTMP_URL ?? ''}
LIVEKIT_INGRESS_WHIP_URL=${LIVEKIT_ENV.LIVEKIT_INGRESS_WHIP_URL ?? ''}
`,
  );
} else if (SKIP_DOCKER) {
  console.log('apps/api/.env existe déjà : conservé');
  // LiveKit only when the shell provides it (otherwise the lives stay peer-to-peer)
  if (Object.keys(LIVEKIT_ENV).length > 0) updateEnvFile(apiEnvPath, LIVEKIT_ENV);
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
    ...LIVEKIT_ENV,
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
  Lives      ${LIVEKIT_ENV.LIVEKIT_URL ? `${LIVEKIT_ENV.LIVEKIT_URL}   (LiveKit)` : 'pair-à-pair (LiveKit non configuré)'}
${LIVEKIT_ENV.LIVEKIT_INGRESS_WHIP_URL ? `  OBS        ${LIVEKIT_ENV.LIVEKIT_INGRESS_WHIP_URL} (WHIP)  ${LIVEKIT_ENV.LIVEKIT_INGRESS_RTMP_URL} (RTMP)   clés : Live > Diffuser avec OBS
` : ''}  Stockage   http://localhost:9001   (MinIO : minioadmin / minioadmin_dev_only)

  Comptes : docs/SEED_ACCOUNTS.md — mot de passe SecurePass123!
  Ctrl+C pour arrêter l'API, le front (et LiveKit sous Windows) ; les services
  Docker restent lancés (arrêt : docker compose -f docker-compose.dev.yml down)
`);

const dev = spawn('npx turbo run dev --filter=@ofm/api --filter=@ofm/web', {
  cwd: ROOT,
  shell: true,
  stdio: 'inherit',
});
// Ctrl+C reaches turbo directly through the shared console; just mirror its exit
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => IS_WINDOWS || dev.kill(signal));
dev.on('exit', (code) => {
  nativeLivekit?.kill();
  process.exit(code ?? 0);
});
