/**
 * Demo / QA seed: one dataset that exercises every feature of the platform.
 *
 *   npm run seed            seed an empty database
 *   npm run seed:fresh      wipe every table, then seed (--reset or SEED_RESET=true)
 *   npm run db:reset        drop the schema, re-apply migrations, then seed
 *
 * All accounts share the password below. See docs/SEED_ACCOUNTS.md for the
 * list of accounts and what each one is meant to test.
 *
 * Media point to public demo URLs (picsum.photos, MDN CC0 samples), so the
 * feed works without MinIO/S3. Stripe IDs are left empty except when
 * SEED_STRIPE_ACCOUNT_ID is set (a Stripe *test* connected account id), which
 * is then assigned to the main creator so paid flows can be tried end to end.
 */
import {
  ContentStatus,
  ContentType,
  ContentVisibility,
  KycStatus,
  MessageStatus,
  NotificationType,
  PayoutStatus,
  Prisma,
  PrismaClient,
  StreamStatus,
  SubscriptionStatus,
  TransactionStatus,
  TransactionType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';

const prisma = new PrismaClient();

export const SEED_PASSWORD = 'SecurePass123!';
// Base32 TOTP secret of the 2FA test account (add it to any authenticator app)
export const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

const PLATFORM_FEE_PERCENTAGE = 15;

// ==================== Helpers ====================

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = new Date();

const daysAgo = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * HOUR);
const daysFromNow = (days: number, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * HOUR);
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60 * 1000);

// Deterministic PRNG so every run produces the same dataset
let prngState = 20261019;
function random() {
  prngState |= 0;
  prngState = (prngState + 0x6d2b79f5) | 0;
  let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randomInt = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
const sample = <T>(items: T[], count: number): T[] => {
  const copy = [...items];
  const result: T[] = [];
  while (copy.length && result.length < count) {
    result.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
  }
  return result;
};

const money = (value: number) => Math.round(value * 100) / 100;
const fees = (amount: number) => {
  const platformFee = money((amount * PLATFORM_FEE_PERCENTAGE) / 100);
  return { platformFee, netAmount: money(amount - platformFee) };
};

const image = (seed: string, width = 1080, height = 1350) =>
  `https://picsum.photos/seed/ofm-${seed}/${width}/${height}`;
const avatar = (n: number) => `https://i.pravatar.cc/300?img=${n}`;
const cover = (seed: string) => image(`cover-${seed}`, 1600, 500);

const DEMO_VIDEOS = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
];
const DEMO_AUDIO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3';

const streamKey = () => `seed_${randomBytes(12).toString('hex')}`;

// ==================== Reset ====================

async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`🧹 ${tables.length} tables vidées`);
}

// ==================== Users ====================

interface UserSeed {
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
  status?: UserStatus;
  emailVerified?: boolean;
  bio?: string;
  avatar?: string;
  coverImage?: string;
  location?: string;
  website?: string;
  kycStatus?: KycStatus;
  createdAt?: Date;
  lastLoginAt?: Date;
  twoFactorSecret?: string;
  stripeAccountId?: string;
  bannedAt?: Date;
  banReason?: string;
  suspendedUntil?: Date;
  suspensionReason?: string;
  creatorProfile?: {
    allowMessages?: boolean;
    allowTips?: boolean;
    welcomeMessage?: string;
    minimumTip?: number;
    averageRating?: number;
  };
}

let hashedPassword = '';

async function createUser(seed: UserSeed) {
  const verified = seed.emailVerified ?? true;
  const createdAt = seed.createdAt ?? daysAgo(200);
  const isCreator = seed.role === UserRole.CREATOR;
  const isSubscriber = seed.role === UserRole.SUBSCRIBER;

  return prisma.user.create({
    data: {
      email: seed.email,
      username: seed.username,
      password: hashedPassword,
      role: seed.role,
      status: seed.status ?? (verified ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION),
      displayName: seed.displayName,
      bio: seed.bio,
      avatar: seed.avatar,
      coverImage: seed.coverImage,
      location: seed.location,
      website: seed.website,
      emailVerified: verified,
      emailVerifiedAt: verified ? createdAt : null,
      kycStatus: seed.kycStatus ?? (isCreator ? KycStatus.VERIFIED : KycStatus.NOT_STARTED),
      kycSubmittedAt: isCreator ? createdAt : null,
      kycVerifiedAt: isCreator && (seed.kycStatus ?? KycStatus.VERIFIED) === KycStatus.VERIFIED ? createdAt : null,
      twoFactorEnabled: !!seed.twoFactorSecret,
      twoFactorSecret: seed.twoFactorSecret,
      stripeAccountId: seed.stripeAccountId,
      stripeOnboarded: !!seed.stripeAccountId,
      bannedAt: seed.bannedAt,
      banReason: seed.banReason,
      suspendedUntil: seed.suspendedUntil,
      suspensionReason: seed.suspensionReason,
      lastLoginAt: seed.lastLoginAt ?? (verified ? daysAgo(randomInt(0, 5)) : null),
      lastActiveAt: seed.lastLoginAt ?? (verified ? daysAgo(randomInt(0, 3)) : null),
      createdAt,
      ...(isCreator && {
        creatorProfile: {
          create: {
            allowMessages: seed.creatorProfile?.allowMessages ?? true,
            allowTips: seed.creatorProfile?.allowTips ?? true,
            welcomeMessage: seed.creatorProfile?.welcomeMessage,
            minimumTip: seed.creatorProfile?.minimumTip ?? 5,
            averageRating: seed.creatorProfile?.averageRating ?? 0,
            createdAt,
          },
        },
      }),
      ...(isSubscriber && { subscriberProfile: { create: { createdAt } } }),
    },
  });
}

// ==================== Main ====================

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Refus de seeder une base de production (SEED_ALLOW_PRODUCTION=true pour forcer).');
  }

  console.log('🌱 Seed de démonstration FanVIP');

  if (
    process.argv.includes('--reset') ||
    process.env.SEED_RESET === 'true' ||
    process.env.NODE_ENV === 'development'
  ) {
    await resetDatabase();
  } else if ((await prisma.user.count()) > 0) {
    throw new Error('La base contient déjà des utilisateurs. Lancez `npm run seed:fresh` pour la vider avant de seeder.');
  }

  hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  // ---------- Staff ----------
  console.log('👤 Comptes staff');
  const admin = await createUser({
    email: 'admin@ofm.com',
    username: 'admin',
    displayName: 'Administrateur',
    role: UserRole.ADMIN,
    bio: 'Compte administrateur de la plateforme FanVIP',
    avatar: avatar(68),
    createdAt: daysAgo(365),
  });
  const moderator = await createUser({
    email: 'moderator@ofm.com',
    username: 'moderateur',
    displayName: 'Modération FanVIP',
    role: UserRole.MODERATOR,
    bio: 'Équipe de modération',
    avatar: avatar(60),
    createdAt: daysAgo(300),
  });

  // ---------- Creators ----------
  console.log('🎨 Créateurs');
  const alice = await createUser({
    email: 'creator@demo.com',
    username: 'demo_creator',
    displayName: 'Alice Martin',
    role: UserRole.CREATOR,
    bio: 'Créatrice lifestyle & voyage. Je partage mes aventures autour du monde 🌍✈️',
    avatar: avatar(1),
    coverImage: cover('alice'),
    location: 'Paris, France',
    website: 'https://alice-martin.example.com',
    createdAt: daysAgo(240),
    stripeAccountId: process.env.SEED_STRIPE_ACCOUNT_ID || undefined,
    creatorProfile: {
      welcomeMessage: 'Merci de ton abonnement ! N’hésite pas à m’écrire 💌',
      minimumTip: 2,
      averageRating: 4.8,
    },
  });
  const bob = await createUser({
    email: 'creator2@demo.com',
    username: 'creator_fitness',
    displayName: 'Bob Dupont',
    role: UserRole.CREATOR,
    bio: 'Coach sportif certifié. Programmes, nutrition et lives HIIT 💪',
    avatar: avatar(12),
    coverImage: cover('bob'),
    location: 'Lyon, France',
    createdAt: daysAgo(200),
    creatorProfile: { averageRating: 4.6 },
  });
  const claire = await createUser({
    email: 'creator3@demo.com',
    username: 'chef_claire',
    displayName: 'Claire Rousseau',
    role: UserRole.CREATOR,
    bio: 'Cheffe pâtissière. Recettes exclusives chaque semaine 🍰 (messages privés désactivés)',
    avatar: avatar(5),
    coverImage: cover('claire'),
    location: 'Bordeaux, France',
    createdAt: daysAgo(150),
    creatorProfile: { allowMessages: false, allowTips: true, averageRating: 4.9 },
  });
  const newCreator = await createUser({
    email: 'newcreator@demo.com',
    username: 'nouveau_createur',
    displayName: 'Hugo Leroy',
    role: UserRole.CREATOR,
    bio: 'Nouveau sur FanVIP — KYC en cours de vérification',
    avatar: avatar(14),
    kycStatus: KycStatus.PENDING,
    createdAt: daysAgo(2),
  });

  // ---------- Key subscribers ----------
  console.log('👥 Abonnés');
  const david = await createUser({
    email: 'subscriber@demo.com',
    username: 'demo_subscriber',
    displayName: 'David Bernard',
    role: UserRole.SUBSCRIBER,
    bio: 'Fan de voyage et de sport',
    avatar: avatar(33),
    location: 'Marseille, France',
    createdAt: daysAgo(180),
  });
  const sophie = await createUser({
    email: 'subscriber2@demo.com',
    username: 'fan_sophie',
    displayName: 'Sophie Lambert',
    role: UserRole.SUBSCRIBER,
    avatar: avatar(47),
    createdAt: daysAgo(150),
  });
  const lucas = await createUser({
    email: 'subscriber3@demo.com',
    username: 'fan_lucas',
    displayName: 'Lucas Petit',
    role: UserRole.SUBSCRIBER,
    bio: 'Je découvre la plateforme',
    avatar: avatar(52),
    createdAt: daysAgo(20),
  });
  const twoFa = await createUser({
    email: '2fa@demo.com',
    username: 'fan_2fa',
    displayName: 'Emma Garnier (2FA)',
    role: UserRole.SUBSCRIBER,
    avatar: avatar(44),
    twoFactorSecret: SEED_TOTP_SECRET,
    createdAt: daysAgo(90),
  });
  const unverified = await createUser({
    email: 'unverified@demo.com',
    username: 'fan_unverified',
    displayName: 'Nina Morel',
    role: UserRole.SUBSCRIBER,
    emailVerified: false,
    createdAt: daysAgo(1),
  });
  const suspended = await createUser({
    email: 'suspended@demo.com',
    username: 'fan_suspended',
    displayName: 'Kevin Roux',
    role: UserRole.SUBSCRIBER,
    avatar: avatar(59),
    status: UserStatus.SUSPENDED,
    suspendedUntil: daysFromNow(7),
    suspensionReason: 'Messages insistants envers une créatrice (signalement #harcèlement)',
    createdAt: daysAgo(120),
  });
  const banned = await createUser({
    email: 'banned@demo.com',
    username: 'fan_banned',
    displayName: 'Spam Bot',
    role: UserRole.SUBSCRIBER,
    avatar: avatar(57),
    status: UserStatus.BANNED,
    bannedAt: daysAgo(5),
    banReason: 'Spam répété de liens externes',
    createdAt: daysAgo(30),
  });

  // ---------- Background fans (history for analytics) ----------
  const firstNames = ['Léa', 'Hugo', 'Chloé', 'Nathan', 'Manon', 'Louis', 'Camille', 'Jules', 'Inès', 'Arthur',
    'Sarah', 'Tom', 'Jade', 'Enzo', 'Lina', 'Noah', 'Zoé', 'Adam', 'Alice', 'Raphaël'];
  const lastNames = ['Durand', 'Lefebvre', 'Moreau', 'Simon', 'Laurent', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux',
    'Vincent', 'Fournier', 'Girard', 'Bonnet', 'Dupuis', 'Lambert', 'Fontaine', 'Rousseau', 'Blanc', 'Guerin'];
  const fans = [];
  for (let i = 1; i <= 20; i++) {
    const n = String(i).padStart(2, '0');
    fans.push(
      await createUser({
        email: `fan${n}@demo.com`,
        username: `fan_${n}`,
        displayName: `${firstNames[i - 1]} ${lastNames[i - 1]}`,
        role: UserRole.SUBSCRIBER,
        avatar: avatar(10 + i),
        createdAt: daysAgo(randomInt(10, 175)),
      }),
    );
  }

  // ---------- Subscription tiers ----------
  console.log('💎 Paliers d’abonnement');
  const tier = (creatorId: string, data: Omit<Prisma.SubscriptionTierUncheckedCreateInput, 'creatorId'>) =>
    prisma.subscriptionTier.create({ data: { creatorId, currency: 'EUR', ...data } });

  const aliceFree = await tier(alice.id, {
    name: 'Fan',
    description: 'Accès gratuit aux posts réservés aux abonnés',
    price: 0,
    benefits: ['Posts abonnés', 'Stories'],
    createdAt: daysAgo(240),
  });
  const aliceBasic = await tier(alice.id, {
    name: 'Essentiel',
    description: 'Tout le contenu exclusif + messages privés',
    price: 9.99,
    benefits: ['Contenu exclusif', 'Messages privés', 'Stories'],
    createdAt: daysAgo(240),
  });
  const alicePremium = await tier(alice.id, {
    name: 'Premium',
    description: 'Contenu premium, lives réservés et réponses prioritaires',
    price: 24.99,
    benefits: ['Tout Essentiel', 'Lives Premium', 'Réponses prioritaires', 'Behind the scenes'],
    createdAt: daysAgo(240),
  });
  const aliceYearly = await tier(alice.id, {
    name: 'VIP annuel',
    description: 'Premium pendant un an, 2 mois offerts',
    price: 199,
    interval: 'year',
    benefits: ['Tout Premium', '2 mois offerts', 'Carte postale de voyage'],
    createdAt: daysAgo(200),
  });
  await tier(alice.id, {
    name: 'Ancienne offre',
    description: 'Offre retirée (inactive)',
    price: 4.99,
    benefits: ['Ancien contenu'],
    isActive: false,
    createdAt: daysAgo(240),
  });
  const bobBasic = await tier(bob.id, {
    name: 'Basique',
    description: 'Programmes d’entraînement hebdomadaires',
    price: 4.99,
    benefits: ['Programme hebdo', 'Vidéos d’exercices'],
    createdAt: daysAgo(200),
  });
  const bobCoaching = await tier(bob.id, {
    name: 'Coaching',
    description: 'Programme personnalisé + suivi nutrition',
    price: 19.99,
    benefits: ['Tout Basique', 'Plan nutrition', 'Suivi mensuel', 'Lives HIIT'],
    createdAt: daysAgo(200),
  });
  const claireTier = await tier(claire.id, {
    name: 'Gourmand',
    description: 'Toutes les recettes et techniques de pâtisserie',
    price: 7.99,
    benefits: ['Recettes exclusives', 'Vidéos pas à pas', 'Fiches PDF'],
    createdAt: daysAgo(150),
  });

  const creatorOf = new Map<string, string>([
    [aliceFree.id, alice.id], [aliceBasic.id, alice.id], [alicePremium.id, alice.id], [aliceYearly.id, alice.id],
    [bobBasic.id, bob.id], [bobCoaching.id, bob.id], [claireTier.id, claire.id],
  ]);
  const tierPrice = new Map<string, number>([
    [aliceFree.id, 0], [aliceBasic.id, 9.99], [alicePremium.id, 24.99], [aliceYearly.id, 199],
    [bobBasic.id, 4.99], [bobCoaching.id, 19.99], [claireTier.id, 7.99],
  ]);
  const tierInterval = new Map<string, 'month' | 'year'>([[aliceYearly.id, 'year']]);

  // ---------- Subscriptions + their payment history ----------
  console.log('📝 Abonnements et historique de paiements');
  const transactions: Prisma.TransactionCreateManyInput[] = [];

  async function subscribe(
    subscriberId: string,
    tierId: string,
    opts: {
      since: Date;
      status?: SubscriptionStatus;
      cancelAtPeriodEnd?: boolean;
      cancelledAt?: Date;
      endedAt?: Date;
      pendingTierId?: string;
    },
  ) {
    const interval = tierInterval.get(tierId) ?? 'month';
    const periodDays = interval === 'year' ? 365 : 30;
    const price = tierPrice.get(tierId) ?? 0;
    const creatorId = creatorOf.get(tierId)!;
    const status = opts.status ?? SubscriptionStatus.ACTIVE;
    const lastDay = opts.endedAt ?? NOW;

    // One payment per period from `since` until today (or until it ended)
    let periodStart = opts.since;
    let charges = 0;
    while (periodStart.getTime() + periodDays * DAY <= lastDay.getTime()) {
      periodStart = new Date(periodStart.getTime() + periodDays * DAY);
      charges++;
    }
    const currentPeriodEnd = new Date(periodStart.getTime() + periodDays * DAY);

    if (price > 0) {
      for (let i = 0; i <= charges; i++) {
        const paidAt = new Date(opts.since.getTime() + i * periodDays * DAY);
        const failed = status === SubscriptionStatus.PAST_DUE && i === charges;
        transactions.push({
          fromUserId: subscriberId,
          toUserId: creatorId,
          type: TransactionType.SUBSCRIPTION,
          status: failed ? TransactionStatus.FAILED : TransactionStatus.COMPLETED,
          amount: price,
          ...fees(price),
          metadata: { kind: i === 0 ? 'NEW_SUBSCRIBER' : 'SUBSCRIPTION_RENEWAL', tierId, period: i + 1 },
          processedAt: failed ? null : paidAt,
          failedAt: failed ? paidAt : null,
          failureReason: failed ? 'Carte refusée (fonds insuffisants)' : null,
          createdAt: paidAt,
        });
      }
    }

    return prisma.subscription.create({
      data: {
        subscriberId,
        tierId,
        status,
        pendingTierId: opts.pendingTierId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: opts.endedAt ?? currentPeriodEnd,
        cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
        cancelledAt: opts.cancelledAt,
        createdAt: opts.since,
      },
    });
  }

  // David: Premium chez Alice, Basique chez Bob
  await subscribe(david.id, alicePremium.id, { since: daysAgo(130) });
  await subscribe(david.id, bobBasic.id, { since: daysAgo(70) });
  // Sophie: résiliation programmée chez Alice, rétrogradation programmée chez Bob, impayé chez Claire
  await subscribe(sophie.id, aliceBasic.id, { since: daysAgo(100), cancelAtPeriodEnd: true, cancelledAt: daysAgo(2) });
  await subscribe(sophie.id, bobCoaching.id, { since: daysAgo(45), pendingTierId: bobBasic.id });
  await subscribe(sophie.id, claireTier.id, { since: daysAgo(64), status: SubscriptionStatus.PAST_DUE });
  // Lucas: ancien abonnement expiré chez Claire (peut se réabonner), aucun abonnement actif
  await subscribe(lucas.id, claireTier.id, {
    since: daysAgo(80),
    status: SubscriptionStatus.EXPIRED,
    endedAt: daysAgo(20),
    cancelledAt: daysAgo(25),
  });
  // Compte 2FA: palier gratuit d'Alice
  await subscribe(twoFa.id, aliceFree.id, { since: daysAgo(60) });
  // Suspendu / banni: anciens abonnés
  await subscribe(suspended.id, aliceBasic.id, {
    since: daysAgo(110),
    status: SubscriptionStatus.CANCELLED,
    endedAt: daysAgo(10),
    cancelledAt: daysAgo(10),
  });

  // Background fans spread over 6 months for the growth / revenue charts
  const paidTiers = [aliceBasic, alicePremium, aliceBasic, alicePremium, aliceYearly, bobBasic, bobCoaching, claireTier];
  for (const fan of fans) {
    const tiersForFan = sample(paidTiers, randomInt(1, 3)).filter(
      (t, i, all) => all.findIndex((other) => creatorOf.get(other.id) === creatorOf.get(t.id)) === i,
    );
    for (const t of tiersForFan) {
      const since = daysAgo(randomInt(5, 170));
      const roll = random();
      if (roll < 0.15) {
        const endedAt = new Date(Math.min(NOW.getTime() - DAY, since.getTime() + randomInt(31, 90) * DAY));
        await subscribe(fan.id, t.id, { since, status: SubscriptionStatus.CANCELLED, endedAt, cancelledAt: endedAt });
      } else if (roll < 0.22) {
        await subscribe(fan.id, t.id, { since, cancelAtPeriodEnd: true, cancelledAt: daysAgo(randomInt(1, 5)) });
      } else {
        await subscribe(fan.id, t.id, { since });
      }
    }
    if (random() < 0.4) {
      await subscribe(fan.id, aliceFree.id, { since: daysAgo(randomInt(5, 150)) });
    }
  }

  // ---------- Content ----------
  console.log('📸 Contenus');
  interface ContentSeed {
    key: string;
    type: ContentType;
    visibility: ContentVisibility;
    status?: ContentStatus;
    title: string;
    description?: string;
    ppvPrice?: number;
    publishedDaysAgo?: number;
    files?: number;
    scheduledInDays?: number;
    removed?: { reason: string };
    moderationNotes?: string;
  }

  const contentByKey = new Map<string, { id: string; creatorId: string; ppvPrice?: number }>();

  async function createContent(creatorId: string, seeds: ContentSeed[]) {
    for (const seed of seeds) {
      const status = seed.status ?? ContentStatus.PUBLISHED;
      const isPublished = status === ContentStatus.PUBLISHED || status === ContentStatus.ARCHIVED;
      const publishedAt = isPublished ? daysAgo(seed.publishedDaysAgo ?? randomInt(1, 120), randomInt(0, 20)) : null;
      const createdAt = publishedAt ?? daysAgo(randomInt(0, 6));
      const isPpv = seed.visibility === ContentVisibility.PPV;

      const files: Prisma.ContentFileCreateWithoutContentInput[] = [];
      const fileCount = seed.files ?? (seed.type === ContentType.TEXT ? 0 : seed.type === ContentType.ALBUM ? 4 : 1);
      for (let i = 0; i < fileCount; i++) {
        if (seed.type === ContentType.VIDEO) {
          files.push({
            filename: `${seed.key}.mp4`,
            originalName: `${seed.title}.mp4`,
            mimeType: 'video/mp4',
            size: BigInt(randomInt(1, 40) * 1024 * 1024),
            storagePath: DEMO_VIDEOS[i % DEMO_VIDEOS.length],
            thumbnailPath: image(`${seed.key}-thumb`, 1280, 720),
            width: 1280,
            height: 720,
            duration: randomInt(10, 600),
            isEncrypted: false,
            order: i,
          });
        } else if (seed.type === ContentType.AUDIO) {
          files.push({
            filename: `${seed.key}.mp3`,
            originalName: `${seed.title}.mp3`,
            mimeType: 'audio/mpeg',
            size: BigInt(randomInt(1, 8) * 1024 * 1024),
            storagePath: DEMO_AUDIO,
            duration: randomInt(30, 300),
            isEncrypted: false,
            order: i,
          });
        } else {
          files.push({
            filename: `${seed.key}-${i + 1}.jpg`,
            originalName: `${seed.title} ${i + 1}.jpg`,
            mimeType: 'image/jpeg',
            size: BigInt(randomInt(200, 4000) * 1024),
            storagePath: image(`${seed.key}-${i + 1}`),
            thumbnailPath: image(`${seed.key}-${i + 1}`, 400, 500),
            width: 1080,
            height: 1350,
            isEncrypted: false,
            hasWatermark: seed.visibility !== ContentVisibility.PUBLIC,
            order: i,
          });
        }
      }

      const content = await prisma.content.create({
        data: {
          creatorId,
          type: seed.type,
          visibility: seed.visibility,
          status: seed.removed ? ContentStatus.REJECTED : status,
          title: seed.title,
          description: seed.description,
          isPpv,
          ppvPrice: isPpv ? seed.ppvPrice : null,
          viewCount: isPublished ? randomInt(40, 2500) : 0,
          publishedAt,
          scheduledFor: seed.scheduledInDays ? daysFromNow(seed.scheduledInDays) : null,
          isModerated: !!seed.removed || !!seed.moderationNotes,
          moderatedAt: seed.removed || seed.moderationNotes ? daysAgo(3) : null,
          moderatedBy: seed.removed || seed.moderationNotes ? admin.id : null,
          moderationNotes: seed.removed?.reason ?? seed.moderationNotes,
          deletedAt: seed.removed ? daysAgo(3) : null,
          createdAt,
          files: { create: files },
        },
      });
      contentByKey.set(seed.key, { id: content.id, creatorId, ppvPrice: seed.ppvPrice });
    }
  }

  await createContent(alice.id, [
    { key: 'alice-bali', type: ContentType.PHOTO, visibility: ContentVisibility.PUBLIC, title: 'Coucher de soleil à Bali 🌅', description: 'Un moment magique sur la plage de Seminyak.', publishedDaysAgo: 2 },
    { key: 'alice-tokyo', type: ContentType.ALBUM, visibility: ContentVisibility.SUBSCRIBERS_ONLY, title: 'Carnet de voyage : Tokyo', description: '4 photos de mes coins préférés à Shibuya et Asakusa.', publishedDaysAgo: 5 },
    { key: 'alice-vlog-islande', type: ContentType.VIDEO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, title: 'Vlog : road trip en Islande', description: 'Cascades, glaciers et aurores boréales.', publishedDaysAgo: 9 },
    { key: 'alice-premium-bts', type: ContentType.ALBUM, visibility: ContentVisibility.PREMIUM_SUBSCRIBERS, title: 'Behind the scenes du shooting', description: 'Réservé aux abonnés Premium.', publishedDaysAgo: 12, files: 3 },
    { key: 'alice-ppv-guide', type: ContentType.VIDEO, visibility: ContentVisibility.PPV, title: 'Guide complet : voyager avec 30 €/jour', description: 'Mon guide vidéo de 45 min, en accès payant.', ppvPrice: 9.99, publishedDaysAgo: 15 },
    { key: 'alice-ppv-presets', type: ContentType.ALBUM, visibility: ContentVisibility.PPV, title: 'Pack de 12 presets Lightroom', description: 'Mes réglages photo, en accès payant.', ppvPrice: 4.99, publishedDaysAgo: 22, files: 2 },
    { key: 'alice-text-conseils', type: ContentType.TEXT, visibility: ContentVisibility.PUBLIC, title: '10 conseils pour bien préparer sa valise', description: '1. Rouler ses vêtements. 2. Toujours un adaptateur universel. 3. Une trousse à pharmacie minimaliste… La suite pour les abonnés !', publishedDaysAgo: 30 },
    { key: 'alice-podcast', type: ContentType.AUDIO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, title: 'Podcast #12 : partir seule en voyage', description: 'Épisode audio de 20 minutes.', publishedDaysAgo: 40 },
    { key: 'alice-maroc', type: ContentType.PHOTO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, title: 'Marrakech, médina et épices', publishedDaysAgo: 55 },
    { key: 'alice-public-lisbonne', type: ContentType.PHOTO, visibility: ContentVisibility.PUBLIC, title: 'Lisbonne en tram 28', publishedDaysAgo: 75 },
    { key: 'alice-archive', type: ContentType.PHOTO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, status: ContentStatus.ARCHIVED, title: 'Ancien post archivé', publishedDaysAgo: 200 },
    { key: 'alice-private', type: ContentType.PHOTO, visibility: ContentVisibility.PRIVATE, title: 'Note privée (visible par moi seule)', publishedDaysAgo: 4 },
    { key: 'alice-draft', type: ContentType.PHOTO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, status: ContentStatus.DRAFT, title: 'Brouillon : Islande partie 2' },
    { key: 'alice-scheduled', type: ContentType.VIDEO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, status: ContentStatus.DRAFT, title: 'Programmé : vlog Patagonie', scheduledInDays: 3 },
  ]);
  await createContent(bob.id, [
    { key: 'bob-hiit', type: ContentType.VIDEO, visibility: ContentVisibility.PUBLIC, title: 'HIIT 15 minutes sans matériel', description: 'Séance découverte gratuite 🔥', publishedDaysAgo: 1 },
    { key: 'bob-programme', type: ContentType.ALBUM, visibility: ContentVisibility.SUBSCRIBERS_ONLY, title: 'Programme semaine 12', description: '4 fiches d’entraînement.', publishedDaysAgo: 6 },
    { key: 'bob-nutrition', type: ContentType.TEXT, visibility: ContentVisibility.PREMIUM_SUBSCRIBERS, title: 'Plan nutrition prise de masse', description: 'Petit-déjeuner : flocons d’avoine, whey, banane. Déjeuner : riz, poulet, légumes…', publishedDaysAgo: 10 },
    { key: 'bob-ppv-programme', type: ContentType.VIDEO, visibility: ContentVisibility.PPV, title: 'Programme complet 8 semaines', ppvPrice: 29.99, publishedDaysAgo: 20 },
    { key: 'bob-abdos', type: ContentType.VIDEO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, title: 'Gainage et abdos', publishedDaysAgo: 33 },
    { key: 'bob-transformation', type: ContentType.PHOTO, visibility: ContentVisibility.PUBLIC, title: 'Transformation d’un élève (avant / après)', publishedDaysAgo: 48 },
    { key: 'bob-removed', type: ContentType.PHOTO, visibility: ContentVisibility.PUBLIC, title: 'Publicité pour un complément non autorisé', publishedDaysAgo: 8, removed: { reason: 'Promotion d’un produit interdit (signalement confirmé)' } },
  ]);
  await createContent(claire.id, [
    { key: 'claire-tarte', type: ContentType.PHOTO, visibility: ContentVisibility.PUBLIC, title: 'Tarte au citron meringuée', publishedDaysAgo: 3 },
    { key: 'claire-paris-brest', type: ContentType.VIDEO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, title: 'Paris-Brest pas à pas', description: 'La vidéo complète, 25 minutes.', publishedDaysAgo: 8 },
    { key: 'claire-macarons', type: ContentType.ALBUM, visibility: ContentVisibility.SUBSCRIBERS_ONLY, title: 'Macarons : les 4 étapes clés', publishedDaysAgo: 16 },
    { key: 'claire-ppv-masterclass', type: ContentType.VIDEO, visibility: ContentVisibility.PPV, title: 'Masterclass entremets', ppvPrice: 14.99, publishedDaysAgo: 25 },
    { key: 'claire-review', type: ContentType.PHOTO, visibility: ContentVisibility.SUBSCRIBERS_ONLY, status: ContentStatus.UNDER_REVIEW, title: 'Recette inspirée (en cours de vérification)', moderationNotes: 'Signalée pour droits d’auteur, en attente de décision' },
    { key: 'claire-rejected', type: ContentType.PHOTO, visibility: ContentVisibility.PUBLIC, status: ContentStatus.REJECTED, title: 'Photo refusée', moderationNotes: 'Image de mauvaise qualité / filigrane tiers' },
  ]);

  const published = (creatorId: string) =>
    prisma.content.findMany({
      where: { creatorId, status: ContentStatus.PUBLISHED, deletedAt: null, visibility: { not: ContentVisibility.PRIVATE } },
      select: { id: true, publishedAt: true },
    });
  const publishedByCreator = new Map([
    [alice.id, await published(alice.id)],
    [bob.id, await published(bob.id)],
    [claire.id, await published(claire.id)],
  ]);
  const allPublished = [...publishedByCreator.values()].flat();

  // ---------- PPV unlocks ----------
  console.log('🔓 Achats PPV');
  async function unlock(userId: string, key: string, daysBack: number) {
    const content = contentByKey.get(key)!;
    const amount = content.ppvPrice!;
    const createdAt = daysAgo(daysBack);
    await prisma.contentUnlock.create({ data: { contentId: content.id, userId, paidAmount: amount, createdAt } });
    transactions.push({
      fromUserId: userId,
      toUserId: content.creatorId,
      type: TransactionType.PPV_UNLOCK,
      status: TransactionStatus.COMPLETED,
      amount,
      ...fees(amount),
      contentId: content.id,
      metadata: { kind: 'PPV_PURCHASE', contentId: content.id },
      processedAt: createdAt,
      createdAt,
    });
  }
  await unlock(david.id, 'alice-ppv-guide', 12);
  await unlock(sophie.id, 'alice-ppv-presets', 18);
  await unlock(sophie.id, 'bob-ppv-programme', 15);
  for (const fan of sample(fans, 6)) await unlock(fan.id, 'alice-ppv-guide', randomInt(1, 14));
  for (const fan of sample(fans, 3)) await unlock(fan.id, 'claire-ppv-masterclass', randomInt(1, 20));
  // Paiement PPV abandonné (PENDING, aucun accès accordé)
  transactions.push({
    fromUserId: lucas.id,
    toUserId: alice.id,
    type: TransactionType.PPV_UNLOCK,
    status: TransactionStatus.PENDING,
    amount: 9.99,
    ...fees(9.99),
    contentId: contentByKey.get('alice-ppv-guide')!.id,
    metadata: { kind: 'PPV_PURCHASE', contentId: contentByKey.get('alice-ppv-guide')!.id },
    createdAt: daysAgo(1),
  });

  // ---------- Tips ----------
  console.log('💸 Pourboires, remboursement, litige');
  const tip = (fromUserId: string, toUserId: string, amount: number, daysBack: number, message?: string, status: TransactionStatus = TransactionStatus.COMPLETED) =>
    transactions.push({
      fromUserId,
      toUserId,
      type: TransactionType.TIP,
      status,
      amount,
      ...fees(amount),
      metadata: { kind: 'TIP', ...(message && { message }) },
      processedAt: status === TransactionStatus.COMPLETED ? daysAgo(daysBack) : null,
      failedAt: status === TransactionStatus.FAILED ? daysAgo(daysBack) : null,
      failureReason: status === TransactionStatus.FAILED ? 'Authentification 3D Secure échouée' : null,
      createdAt: daysAgo(daysBack),
    });
  tip(david.id, alice.id, 20, 3, 'Merci pour le vlog Islande, incroyable !');
  tip(david.id, bob.id, 5, 11, 'Super séance 💪');
  tip(sophie.id, alice.id, 10, 25);
  tip(lucas.id, bob.id, 15, 2, 'Premier pourboire !', TransactionStatus.FAILED);
  for (let i = 0; i < 25; i++) {
    tip(pick(fans).id, pick([alice.id, alice.id, bob.id, claire.id]), pick([2, 5, 5, 10, 20, 50]), randomInt(0, 170));
  }

  // Remboursement: un paiement d'abonnement remboursé + l'écriture de remboursement
  transactions.push(
    {
      fromUserId: fans[0].id,
      toUserId: alice.id,
      type: TransactionType.SUBSCRIPTION,
      status: TransactionStatus.REFUNDED,
      amount: 24.99,
      ...fees(24.99),
      metadata: { kind: 'SUBSCRIPTION', refundReason: 'Double prélèvement' },
      processedAt: daysAgo(40),
      createdAt: daysAgo(40),
    },
    {
      fromUserId: alice.id,
      toUserId: fans[0].id,
      type: TransactionType.REFUND,
      status: TransactionStatus.COMPLETED,
      amount: 24.99,
      platformFee: 0,
      netAmount: 24.99,
      metadata: { kind: 'REFUND', reason: 'Double prélèvement' },
      processedAt: daysAgo(38),
      createdAt: daysAgo(38),
    },
  );

  // ---------- Live streams ----------
  console.log('📡 Lives');
  await prisma.liveStream.create({
    data: {
      creatorId: bob.id,
      title: 'HIIT en direct 🔥',
      description: 'Live en cours : connectez-vous en tant que Bob sur /creator/live pour diffuser.',
      thumbnailUrl: image('live-bob-hiit', 1280, 720),
      status: StreamStatus.LIVE,
      streamKey: streamKey(),
      visibility: ContentVisibility.PUBLIC,
      startedAt: minutesAgo(12),
      scheduledFor: minutesAgo(15),
    },
  });
  await prisma.liveStream.create({
    data: {
      creatorId: alice.id,
      title: 'Q&A voyage au Japon',
      description: 'Posez vos questions sur mon itinéraire de 3 semaines.',
      thumbnailUrl: image('live-alice-japon', 1280, 720),
      status: StreamStatus.SCHEDULED,
      streamKey: streamKey(),
      visibility: ContentVisibility.SUBSCRIBERS_ONLY,
      scheduledFor: daysFromNow(1, 2),
      // Donation goal milestones, shown as soon as the live starts
      tipGoals: {
        create: [
          { amount: 100, label: 'Je réponds à toutes vos questions', position: 0 },
          { amount: 200, label: '30 minutes de live en plus', position: 1 },
          { amount: 500, label: 'Surprise exclusive pour mes abonnés', position: 2 },
        ],
      },
    },
  });
  const alicePpvLive = await prisma.liveStream.create({
    data: {
      creatorId: alice.id,
      title: 'Masterclass photo de voyage (payant)',
      description: '2 heures de techniques photo, accès payant.',
      thumbnailUrl: image('live-alice-masterclass', 1280, 720),
      status: StreamStatus.SCHEDULED,
      streamKey: streamKey(),
      visibility: ContentVisibility.PPV,
      isPpv: true,
      ppvPrice: 12.99,
      scheduledFor: daysFromNow(3, 5),
    },
  });
  const aliceEndedLive = await prisma.liveStream.create({
    data: {
      creatorId: alice.id,
      title: 'Live Premium : retour d’Islande',
      description: 'Réservé aux abonnés Premium.',
      thumbnailUrl: image('live-alice-islande', 1280, 720),
      status: StreamStatus.ENDED,
      streamKey: streamKey(),
      visibility: ContentVisibility.PREMIUM_SUBSCRIBERS,
      scheduledFor: daysAgo(6, 1),
      startedAt: daysAgo(6),
      endedAt: new Date(daysAgo(6).getTime() + 75 * 60 * 1000),
      duration: 75 * 60,
      peakViewers: 48,
      totalViews: 112,
    },
  });
  const claireEndedLive = await prisma.liveStream.create({
    data: {
      creatorId: claire.id,
      title: 'Atelier choux en direct',
      thumbnailUrl: image('live-claire-choux', 1280, 720),
      status: StreamStatus.ENDED,
      streamKey: streamKey(),
      visibility: ContentVisibility.PUBLIC,
      recordingUrl: DEMO_VIDEOS[0],
      startedAt: daysAgo(14),
      endedAt: new Date(daysAgo(14).getTime() + 50 * 60 * 1000),
      duration: 50 * 60,
      peakViewers: 31,
      totalViews: 77,
    },
  });
  await prisma.liveStream.create({
    data: {
      creatorId: bob.id,
      title: 'Live annulé : séance mobilité',
      status: StreamStatus.CANCELLED,
      streamKey: streamKey(),
      visibility: ContentVisibility.SUBSCRIBERS_ONLY,
      scheduledFor: daysAgo(3),
    },
  });

  // Ended live: viewers + chat history
  const liveViewers = [david, ...sample(fans, 8)];
  for (const viewer of liveViewers) {
    const joinedAt = new Date(daysAgo(6).getTime() + randomInt(0, 30) * 60 * 1000);
    await prisma.streamViewer.create({
      data: { streamId: aliceEndedLive.id, viewerId: viewer.id, joinedAt, leftAt: new Date(joinedAt.getTime() + randomInt(10, 45) * 60 * 1000) },
    });
  }
  const chatLines = ['Coucou Alice ! 👋', 'Les aurores boréales 😍', 'Tu y retournes quand ?', 'Quel appareil photo tu utilises ?', 'Merci pour ce live !', 'Trop beau 🔥', 'Tu conseilles quelle saison ?'];
  for (let i = 0; i < chatLines.length; i++) {
    await prisma.streamMessage.create({
      data: {
        streamId: aliceEndedLive.id,
        senderId: i === 2 ? alice.id : liveViewers[i % liveViewers.length].id,
        message: i === 2 ? 'Sûrement cet hiver, je vous tiens au courant !' : chatLines[i],
        createdAt: new Date(daysAgo(6).getTime() + (5 + i * 6) * 60 * 1000),
      },
    });
  }
  for (const viewer of sample(fans, 5)) {
    await prisma.streamViewer.create({ data: { streamId: claireEndedLive.id, viewerId: viewer.id, joinedAt: daysAgo(14), leftAt: daysAgo(14) } });
  }
  // ---------- Live tip menu ("paliers de dons") ----------
  // Alice's menu, reused from one live to the next; the ended live got
  // donation goal milestones, tips (free and from the menu) counted in
  // tipTotal, their chat lines and requests
  const aliceMenu = [
    { emoji: '👋', label: 'Je dis ton prénom', amount: 5, description: 'Un petit coucou personnalisé en direct' },
    { emoji: '🎵', label: 'Je chante une chanson', amount: 20, description: 'Tu choisis le titre dans ton message' },
    { emoji: '💪', label: '10 pompes', amount: 10, description: null },
    { emoji: '❓', label: 'Je réponds à ta question', amount: 15, description: 'Pose ta question avec le pourboire' },
    { emoji: '🎁', label: 'Surprise', amount: 50, description: 'Je te réserve une surprise en fin de live' },
  ];
  const aliceMenuItems = [];
  for (const [position, item] of aliceMenu.entries()) {
    aliceMenuItems.push(await prisma.liveTipMenuItem.create({ data: { creatorId: alice.id, position, ...item } }));
  }

  const endedLiveStart = daysAgo(6).getTime();
  const endedLiveTips: {
    fan: { id: string };
    amount: number;
    minute: number;
    message?: string;
    item?: number;
    status?: 'PENDING' | 'DONE' | 'SKIPPED';
  }[] = [
    // Free tip (shows in the creator's tip history)
    { fan: david, amount: 10, minute: 12, message: 'Pour le live 🙏' },
    { fan: david, amount: 20, minute: 18, item: 1, status: 'DONE', message: 'La Reine des neiges !' },
    { fan: liveViewers[1], amount: 5, minute: 24, item: 0, status: 'DONE' },
    { fan: liveViewers[2], amount: 15, minute: 41, item: 3, status: 'DONE', message: 'Ton meilleur souvenir là-bas ?' },
    { fan: liveViewers[3], amount: 10, minute: 52, item: 2, status: 'SKIPPED' },
    { fan: david, amount: 50, minute: 70, item: 4, status: 'PENDING' },
  ];
  let endedLiveTipTotal = 0;
  for (const tipSeed of endedLiveTips) {
    const id = randomUUID();
    const at = new Date(endedLiveStart + tipSeed.minute * 60 * 1000);
    const item = tipSeed.item !== undefined ? aliceMenuItems[tipSeed.item] : null;
    endedLiveTipTotal += tipSeed.amount;
    transactions.push({
      id,
      fromUserId: tipSeed.fan.id,
      toUserId: alice.id,
      type: TransactionType.TIP,
      status: TransactionStatus.COMPLETED,
      amount: tipSeed.amount,
      ...fees(tipSeed.amount),
      metadata: {
        kind: 'tip',
        streamId: aliceEndedLive.id,
        message: tipSeed.message ?? null,
        ...(item && { menuItemId: item.id, menuItemLabel: item.label }),
      },
      processedAt: at,
      createdAt: at,
    });
    await prisma.streamMessage.create({
      data: {
        streamId: aliceEndedLive.id,
        senderId: tipSeed.fan.id,
        type: 'TIP',
        tipAmount: tipSeed.amount,
        transactionId: id,
        message: tipSeed.message ?? `a envoyé un pourboire de ${tipSeed.amount.toFixed(2)}€`,
        createdAt: at,
      },
    });
    if (item) {
      await prisma.liveTipAction.create({
        data: {
          streamId: aliceEndedLive.id,
          transactionId: id,
          menuItemId: item.id,
          label: item.label,
          amount: tipSeed.amount,
          fromUserId: tipSeed.fan.id,
          status: tipSeed.status ?? 'PENDING',
          createdAt: at,
          completedAt: tipSeed.status && tipSeed.status !== 'PENDING' ? new Date(at.getTime() + 3 * 60 * 1000) : null,
        },
      });
    }
  }
  // Milestones of the ended live (total 110 €): 50 € reached at minute 41
  // and done, 100 € reached at minute 70, 250 € not reached; each reached
  // milestone was announced once in the chat
  await prisma.liveStream.update({ where: { id: aliceEndedLive.id }, data: { tipTotal: endedLiveTipTotal } });
  const endedLiveGoals = [
    { amount: 50, label: 'Je raconte ma pire galère de voyage', minute: 41, doneMinute: 46 },
    { amount: 100, label: 'Tirage photo dédicacé pour un abonné', minute: 70 },
    { amount: 250, label: 'Live bonus depuis Reykjavik' },
  ];
  for (const [position, goalSeed] of endedLiveGoals.entries()) {
    const reachedAt = goalSeed.minute !== undefined ? new Date(endedLiveStart + goalSeed.minute * 60 * 1000 + 1000) : null;
    await prisma.liveTipGoal.create({
      data: {
        streamId: aliceEndedLive.id,
        amount: goalSeed.amount,
        label: goalSeed.label,
        position,
        reachedAt,
        completedAt: goalSeed.doneMinute !== undefined ? new Date(endedLiveStart + goalSeed.doneMinute * 60 * 1000) : null,
      },
    });
    if (reachedAt) {
      await prisma.streamMessage.create({
        data: {
          streamId: aliceEndedLive.id,
          senderId: alice.id,
          type: 'SYSTEM',
          // Same line as LiveTipsService.recordTip (goalReachedMessage)
          message: `🎯 Palier atteint : ${goalSeed.amount}\u00a0€ — ${goalSeed.label}`,
          createdAt: reachedAt,
        },
      });
    }
  }
  // Sophie already bought the upcoming PPV live (she can join it), David has not
  transactions.push({
    fromUserId: sophie.id,
    toUserId: alice.id,
    type: TransactionType.PPV_UNLOCK,
    status: TransactionStatus.COMPLETED,
    amount: 12.99,
    ...fees(12.99),
    contentId: alicePpvLive.id,
    metadata: { kind: 'PPV_PURCHASE', streamId: alicePpvLive.id },
    processedAt: daysAgo(1),
    createdAt: daysAgo(1),
  });

  // ---------- Save transactions ----------
  await prisma.transaction.createMany({ data: transactions });

  // Disputed payment (chargeback) with its Dispute row
  const disputed = await prisma.transaction.create({
    data: {
      fromUserId: fans[1].id,
      toUserId: bob.id,
      type: TransactionType.TIP,
      status: TransactionStatus.DISPUTED,
      amount: 50,
      ...fees(50),
      metadata: { kind: 'TIP' },
      processedAt: daysAgo(9),
      createdAt: daysAgo(9),
    },
  });
  await prisma.dispute.create({
    data: {
      stripeDisputeId: 'dp_seed_demo_0001',
      transactionId: disputed.id,
      amount: 5000, // cents, as sent by Stripe
      currency: 'eur',
      reason: 'fraudulent',
      status: 'needs_response',
      evidenceDueBy: daysFromNow(10),
      createdAt: daysAgo(4),
    },
  });

  // ---------- Payouts ----------
  console.log('🏦 Versements');
  // Amounts derived from each creator's real net earnings so balances stay positive
  const netEarned = (creatorId: string) =>
    transactions
      .filter((t) => t.toUserId === creatorId && t.status === TransactionStatus.COMPLETED && t.type !== TransactionType.REFUND)
      .reduce((sum, t) => sum + Number(t.netAmount), 0);
  const share = (creatorId: string, ratio: number) => money(Math.floor(netEarned(creatorId) * ratio));
  await prisma.payout.createMany({
    data: [
      { creatorId: alice.id, status: PayoutStatus.COMPLETED, amount: share(alice.id, 0.25), destinationType: 'bank_account', destination: '4242', requestedAt: daysAgo(62), processedAt: daysAgo(61), paidAt: daysAgo(59), createdAt: daysAgo(62) },
      { creatorId: alice.id, status: PayoutStatus.COMPLETED, amount: share(alice.id, 0.3), destinationType: 'bank_account', destination: '4242', requestedAt: daysAgo(31), processedAt: daysAgo(30), paidAt: daysAgo(28), createdAt: daysAgo(31) },
      { creatorId: alice.id, status: PayoutStatus.FAILED, amount: share(alice.id, 0.1), destinationType: 'bank_account', destination: '0000', requestedAt: daysAgo(15), failedAt: daysAgo(14), failureReason: 'IBAN invalide', createdAt: daysAgo(15) },
      { creatorId: alice.id, status: PayoutStatus.PROCESSING, amount: share(alice.id, 0.15), destinationType: 'bank_account', destination: '4242', requestedAt: daysAgo(1), processedAt: daysAgo(1), createdAt: daysAgo(1) },
      { creatorId: bob.id, status: PayoutStatus.COMPLETED, amount: share(bob.id, 0.4), destinationType: 'bank_account', destination: '1881', requestedAt: daysAgo(30), processedAt: daysAgo(29), paidAt: daysAgo(27), createdAt: daysAgo(30) },
      { creatorId: bob.id, status: PayoutStatus.PENDING, amount: share(bob.id, 0.2), destinationType: 'bank_account', destination: '1881', requestedAt: daysAgo(0, 3), createdAt: daysAgo(0, 3) },
    ],
  });

  // ---------- Likes & comments ----------
  console.log('❤️ Likes et commentaires');
  const socialUsers = [david, sophie, lucas, twoFa, ...fans];
  const likes: Prisma.ContentLikeCreateManyInput[] = [];
  for (const content of allPublished) {
    for (const user of sample(socialUsers, randomInt(2, 14))) {
      likes.push({ contentId: content.id, userId: user.id, createdAt: daysAgo(randomInt(0, 30)) });
    }
  }
  await prisma.contentLike.createMany({ data: likes, skipDuplicates: true });

  const commentTexts = ['Magnifique ! 😍', 'Merci pour le partage', 'J’adore, vivement la suite', 'Trop inspirant 🔥', 'Tu as fait ça comment ?',
    'Incroyable travail 👏', 'Je teste ce week-end !', 'Meilleur contenu de la semaine', 'Wow 🤩', 'Des conseils pour débuter ?'];
  const comments: Prisma.CommentCreateManyInput[] = [];
  for (const content of allPublished) {
    for (let i = 0; i < randomInt(0, 6); i++) {
      comments.push({ contentId: content.id, userId: pick(socialUsers).id, text: pick(commentTexts), createdAt: daysAgo(randomInt(0, 25), randomInt(0, 23)) });
    }
  }
  const aliceBali = contentByKey.get('alice-bali')!.id;
  comments.push(
    { contentId: aliceBali, userId: david.id, text: 'Je rêve d’y aller, merci Alice !', createdAt: daysAgo(1) },
    { contentId: aliceBali, userId: alice.id, text: 'Merci David 🥰 fonce !', createdAt: daysAgo(1) },
    { contentId: aliceBali, userId: banned.id, text: 'GAGNEZ 1000€ PAR JOUR ➡️ lien-suspect.example', createdAt: daysAgo(6) },
    { contentId: aliceBali, userId: suspended.id, text: 'Réponds à mes messages !!!', createdAt: daysAgo(12) },
    { contentId: aliceBali, userId: sophie.id, text: 'Commentaire supprimé', createdAt: daysAgo(3), deletedAt: daysAgo(2) },
  );
  // Not edited: updatedAt must match createdAt (the UI flags edited comments)
  await prisma.comment.createMany({
    data: comments.map((comment) => ({ ...comment, updatedAt: comment.updatedAt ?? comment.createdAt })),
  });
  const spamComment = await prisma.comment.findFirstOrThrow({ where: { userId: banned.id } });

  // ---------- Follows ----------
  console.log('➕ Follows');
  const follows: Prisma.FollowCreateManyInput[] = [
    { followerId: david.id, creatorId: alice.id, createdAt: daysAgo(130) },
    { followerId: david.id, creatorId: bob.id, createdAt: daysAgo(70) },
    { followerId: david.id, creatorId: claire.id, createdAt: daysAgo(10) },
    { followerId: sophie.id, creatorId: alice.id, createdAt: daysAgo(100) },
    { followerId: lucas.id, creatorId: bob.id, createdAt: daysAgo(5) },
  ];
  for (const fan of fans) {
    for (const creator of sample([alice, alice, bob, claire, newCreator], randomInt(0, 3))) {
      follows.push({ followerId: fan.id, creatorId: creator.id, createdAt: daysAgo(randomInt(1, 160)) });
    }
  }
  await prisma.follow.createMany({ data: follows, skipDuplicates: true });

  // ---------- Stories ----------
  console.log('📱 Stories');
  async function story(creatorId: string, data: Omit<Prisma.StoryUncheckedCreateInput, 'creatorId' | 'expiresAt'>, hoursAgo: number, viewers: string[] = [], likers: string[] = []) {
    const createdAt = new Date(NOW.getTime() - hoursAgo * HOUR);
    const created = await prisma.story.create({
      data: { creatorId, ...data, createdAt, expiresAt: new Date(createdAt.getTime() + 24 * HOUR), viewCount: viewers.length },
    });
    if (viewers.length) {
      await prisma.storyView.createMany({ data: viewers.map((viewerId) => ({ storyId: created.id, viewerId, viewedAt: new Date(createdAt.getTime() + HOUR) })) });
    }
    if (likers.length) {
      await prisma.storyLike.createMany({ data: likers.map((userId) => ({ storyId: created.id, userId })) });
    }
  }
  const fanIds = fans.map((f) => f.id);
  await story(alice.id, { type: ContentType.PHOTO, mediaUrl: image('story-alice-1', 1080, 1920), caption: 'Petit-déj avec vue ☕', visibility: ContentVisibility.PUBLIC, width: 1080, height: 1920 }, 3, [david.id, sophie.id, ...fanIds.slice(0, 6)], [sophie.id, fanIds[0]]);
  await story(alice.id, { type: ContentType.PHOTO, mediaUrl: image('story-alice-2', 1080, 1920), caption: 'Exclu abonnés : nouvelle destination demain 🤫', visibility: ContentVisibility.SUBSCRIBERS_ONLY, width: 1080, height: 1920 }, 2, fanIds.slice(2, 5));
  await story(alice.id, { type: ContentType.TEXT, text: 'Sondage : Japon ou Pérou pour le prochain vlog ? Répondez en message 💬', visibility: ContentVisibility.PUBLIC }, 1);
  await story(alice.id, { type: ContentType.PHOTO, mediaUrl: image('story-alice-old', 1080, 1920), caption: 'Story expirée (ne doit plus apparaître)', visibility: ContentVisibility.PUBLIC }, 30);
  await story(bob.id, { type: ContentType.VIDEO, mediaUrl: DEMO_VIDEOS[0], thumbnailUrl: image('story-bob-thumb', 1080, 1920), duration: 5, caption: 'Échauffement du matin', visibility: ContentVisibility.PUBLIC }, 5, [david.id, lucas.id], [david.id]);
  await story(claire.id, { type: ContentType.PHOTO, mediaUrl: image('story-claire-1', 1080, 1920), caption: 'Fournée de croissants 🥐', visibility: ContentVisibility.PUBLIC }, 8, fanIds.slice(5, 9));

  // ---------- Conversations & messages ----------
  console.log('💬 Messagerie');
  async function conversation(a: { id: string }, b: { id: string }, lines: { from: 'a' | 'b'; text: string; minutesAgo: number; read?: boolean; ppvPrice?: number; purchased?: boolean; attachment?: string }[]) {
    let last: { id: string } | null = null;
    for (const line of lines) {
      const sender = line.from === 'a' ? a : b;
      const receiver = line.from === 'a' ? b : a;
      const createdAt = minutesAgo(line.minutesAgo);
      const read = line.read ?? true;
      last = await prisma.message.create({
        data: {
          senderId: sender.id,
          receiverId: receiver.id,
          content: line.text,
          status: read ? MessageStatus.READ : MessageStatus.DELIVERED,
          readAt: read ? new Date(createdAt.getTime() + 5 * 60 * 1000) : null,
          hasAttachment: !!line.attachment,
          attachmentUrl: line.attachment,
          isPpv: line.ppvPrice != null,
          ppvPrice: line.ppvPrice,
          isPurchased: line.purchased ?? false,
          createdAt,
        },
      });
    }
    await prisma.conversation.create({
      data: { participant1Id: a.id, participant2Id: b.id, lastMessageId: last?.id, createdAt: minutesAgo(lines[0].minutesAgo), updatedAt: minutesAgo(lines[lines.length - 1].minutesAgo) },
    });
  }
  await conversation(david, alice, [
    { from: 'a', text: 'Salut Alice ! J’adore ton contenu sur l’Islande', minutesAgo: 60 * 24 * 5 },
    { from: 'b', text: 'Merci beaucoup David 😊', minutesAgo: 60 * 24 * 5 - 30 },
    { from: 'a', text: 'Tu as un conseil pour un premier voyage là-bas ?', minutesAgo: 60 * 24 * 4 },
    { from: 'b', text: 'Pars en septembre, moins de monde et des aurores 🌌', minutesAgo: 60 * 24 * 4 - 20 },
    { from: 'b', text: 'Voici ma carte d’itinéraire', minutesAgo: 60 * 24 * 3, attachment: image('msg-alice-map', 1200, 800) },
    { from: 'b', text: 'Mon guide PDF détaillé (contenu payant)', minutesAgo: 60 * 24 * 2, ppvPrice: 7.99 },
    { from: 'b', text: 'Photos bonus du voyage (déjà acheté)', minutesAgo: 60 * 24, ppvPrice: 3.99, purchased: true },
    { from: 'b', text: 'Tu as vu mon nouveau post sur Bali ?', minutesAgo: 45, read: false },
  ]);
  await conversation(david, bob, [
    { from: 'b', text: 'Bienvenue dans le programme ! 💪', minutesAgo: 60 * 24 * 70 },
    { from: 'a', text: 'Merci ! Combien de séances par semaine ?', minutesAgo: 60 * 24 * 69 },
    { from: 'b', text: '3 séances + 1 de mobilité, c’est parfait pour commencer', minutesAgo: 60 * 24 * 69 - 60 },
  ]);
  await conversation(sophie, alice, [
    { from: 'a', text: 'Coucou, je vais devoir mettre mon abonnement en pause', minutesAgo: 60 * 24 * 2 },
    { from: 'b', text: 'Pas de souci Sophie, à bientôt j’espère ! 💛', minutesAgo: 60 * 3, read: false },
  ]);
  await conversation(claire, david, [
    { from: 'a', text: 'Merci de me suivre David ! Les messages sont fermés, mais je réponds ici 😉', minutesAgo: 60 * 24 * 9 },
  ]);
  await conversation(admin, alice, [
    { from: 'a', text: 'Bonjour Alice, votre KYC est validé. Bienvenue sur FanVIP !', minutesAgo: 60 * 24 * 230 },
    { from: 'b', text: 'Merci beaucoup !', minutesAgo: 60 * 24 * 230 - 60 },
  ]);
  await conversation(suspended, alice, [
    { from: 'a', text: 'Pourquoi tu ne réponds jamais ???', minutesAgo: 60 * 24 * 12 },
    { from: 'a', text: 'Réponds-moi !!!', minutesAgo: 60 * 24 * 12 - 2 },
  ]);
  const harassingMessage = await prisma.message.findFirstOrThrow({ where: { senderId: suspended.id }, orderBy: { createdAt: 'desc' } });

  // ---------- Reports ----------
  console.log('🚩 Signalements');
  await prisma.report.createMany({
    data: [
      { reporterId: david.id, reportedType: 'COMMENT', reportedId: spamComment.id, reason: 'SPAM', description: 'Lien d’arnaque dans les commentaires', status: 'pending', createdAt: daysAgo(1) },
      { reporterId: sophie.id, reportedType: 'CONTENT', reportedId: contentByKey.get('claire-review')!.id, reason: 'COPYRIGHT', description: 'Photo reprise d’un livre de cuisine', status: 'pending', createdAt: daysAgo(2) },
      { reporterId: lucas.id, reportedType: 'USER', reportedId: newCreator.id, reason: 'FAKE_NEWS', description: 'Profil qui semble usurper une identité', status: 'pending', createdAt: daysAgo(0, 5) },
      { reporterId: fans[3].id, reportedType: 'CONTENT', reportedId: contentByKey.get('bob-hiit')!.id, reason: 'OTHER', description: 'Le son est trop fort', status: 'reviewed', reviewedBy: moderator.id, reviewedAt: daysAgo(1), createdAt: daysAgo(3) },
      { reporterId: alice.id, reportedType: 'USER', reportedId: suspended.id, reason: 'HARASSMENT', description: 'Messages insistants et agressifs', status: 'resolved', reviewedBy: admin.id, reviewedAt: daysAgo(10), resolution: 'Utilisateur suspendu 7 jours', createdAt: daysAgo(12) },
      { reporterId: alice.id, reportedType: 'MESSAGE', reportedId: harassingMessage.id, reason: 'HARASSMENT', status: 'resolved', reviewedBy: admin.id, reviewedAt: daysAgo(10), resolution: 'Traité avec le signalement utilisateur', createdAt: daysAgo(12) },
      { reporterId: fans[4].id, reportedType: 'CONTENT', reportedId: contentByKey.get('bob-removed')!.id, reason: 'ILLEGAL_CONTENT', description: 'Produit dopant', status: 'resolved', reviewedBy: admin.id, reviewedAt: daysAgo(3), resolution: 'Contenu retiré', createdAt: daysAgo(4) },
      { reporterId: fans[5].id, reportedType: 'USER', reportedId: banned.id, reason: 'SPAM', status: 'resolved', reviewedBy: admin.id, reviewedAt: daysAgo(5), resolution: 'Compte banni', createdAt: daysAgo(6) },
      { reporterId: lucas.id, reportedType: 'CONTENT', reportedId: contentByKey.get('alice-bali')!.id, reason: 'NUDITY', description: 'Signalement erroné', status: 'dismissed', reviewedBy: moderator.id, reviewedAt: daysAgo(7), resolution: 'Aucune infraction', createdAt: daysAgo(8) },
    ],
  });

  // ---------- Audit log ----------
  await prisma.auditLog.createMany({
    data: [
      { userId: admin.id, action: 'USER_SUSPEND', resource: 'USER', resourceId: suspended.id, metadata: { reason: 'Harcèlement', durationDays: 7 }, createdAt: daysAgo(10) },
      { userId: admin.id, action: 'REPORT_RESOLVED', resource: 'REPORT', metadata: { reportedType: 'USER', reportedId: suspended.id }, createdAt: daysAgo(10) },
      { userId: admin.id, action: 'USER_BAN', resource: 'USER', resourceId: banned.id, metadata: { reason: 'Spam répété' }, createdAt: daysAgo(5) },
      { userId: admin.id, action: 'CONTENT_REMOVED', resource: 'CONTENT', resourceId: contentByKey.get('bob-removed')!.id, metadata: { reason: 'Produit interdit' }, createdAt: daysAgo(3) },
      { userId: moderator.id, action: 'REPORT_RESOLVED', resource: 'REPORT', metadata: { decision: 'dismissed' }, createdAt: daysAgo(7) },
    ],
  });

  // ---------- Notifications ----------
  console.log('🔔 Notifications');
  const notif = (userId: string, type: NotificationType, title: string, message: string, hoursAgo: number, opts: { read?: boolean; linkUrl?: string; metadata?: Prisma.InputJsonValue } = {}): Prisma.NotificationCreateManyInput => ({
    userId,
    type,
    title,
    message,
    linkUrl: opts.linkUrl,
    isRead: opts.read ?? false,
    readAt: opts.read ? new Date(NOW.getTime() - hoursAgo * HOUR + HOUR) : null,
    metadata: opts.metadata,
    createdAt: new Date(NOW.getTime() - hoursAgo * HOUR),
  });
  await prisma.notification.createMany({
    data: [
      // David
      notif(david.id, NotificationType.NEW_MESSAGE, 'Nouveau message', 'Alice Martin vous a envoyé un message', 1, { linkUrl: '/messages?user=demo_creator', metadata: { kind: 'NEW_MESSAGE' } }),
      notif(david.id, NotificationType.SYSTEM, 'Nouveau contenu', 'Alice Martin a publié « Coucher de soleil à Bali »', 48, { linkUrl: `/content/${aliceBali}`, metadata: { kind: 'NEW_CONTENT' } }),
      notif(david.id, NotificationType.SUBSCRIPTION_RENEWAL, 'Abonnement renouvelé', 'Votre abonnement Premium chez Alice Martin a été renouvelé (24,99 €)', 24 * 10, { read: true, linkUrl: '/subscriptions', metadata: { kind: 'SUBSCRIPTION_RENEWAL', amount: 24.99 } }),
      notif(david.id, NotificationType.SYSTEM, 'Bienvenue sur FanVIP', 'Découvrez les créateurs à suivre dans l’onglet Découvrir', 24 * 180, { read: true, linkUrl: '/discover' }),
      // Alice
      notif(alice.id, NotificationType.NEW_TIP, 'Nouveau pourboire', 'David Bernard vous a envoyé 20,00 € : « Merci pour le vlog Islande »', 72, { linkUrl: '/creator/earnings', metadata: { kind: 'TIP', amount: 20, fromUserId: david.id } }),
      notif(alice.id, NotificationType.NEW_SUBSCRIBER, 'Nouvel abonné', `${fans[2].displayName} s’est abonné(e) à Premium`, 5, { linkUrl: '/creator/subscriptions', metadata: { kind: 'NEW_SUBSCRIBER' } }),
      notif(alice.id, NotificationType.NEW_COMMENT, 'Nouveau commentaire', 'David Bernard a commenté « Coucher de soleil à Bali »', 20, { linkUrl: `/content/${aliceBali}`, metadata: { kind: 'COMMENT' } }),
      notif(alice.id, NotificationType.NEW_FOLLOWER, 'Nouveau follower', `${fans[7].displayName} vous suit`, 30, { linkUrl: `/${fans[7].username}`, metadata: { kind: 'NEW_FOLLOWER' } }),
      notif(alice.id, NotificationType.SYSTEM, 'Contenu débloqué', 'Un fan a débloqué « Guide complet : voyager avec 30 €/jour » (9,99 €)', 40, { read: true, metadata: { kind: 'PPV_PURCHASE', amount: 9.99, contentId: contentByKey.get('alice-ppv-guide')!.id } }),
      notif(alice.id, NotificationType.PAYOUT_COMPLETED, 'Versement effectué', 'Votre dernier versement a été envoyé sur votre compte bancaire', 24 * 28, { read: true, linkUrl: '/creator/earnings', metadata: { kind: 'PAYOUT' } }),
      notif(alice.id, NotificationType.SYSTEM, 'Échec de versement', 'Un versement a échoué : IBAN invalide', 24 * 14, { linkUrl: '/creator/earnings', metadata: { kind: 'PAYOUT_FAILED' } }),
      // Bob / Claire / Hugo
      notif(bob.id, NotificationType.NEW_SUBSCRIBER, 'Nouvel abonné', 'Sophie Lambert s’est abonnée à Coaching', 24 * 45, { read: true, metadata: { kind: 'NEW_SUBSCRIBER' } }),
      notif(bob.id, NotificationType.SYSTEM, 'Contenu retiré', 'Votre publication « Publicité pour un complément non autorisé » a été retirée', 72, { metadata: { kind: 'CONTENT_REMOVED' } }),
      notif(bob.id, NotificationType.SYSTEM, 'Litige ouvert', 'Un paiement de 50,00 € fait l’objet d’un litige', 24 * 4, { metadata: { kind: 'DISPUTE' } }),
      notif(claire.id, NotificationType.CONTENT_REJECTED, 'Contenu refusé', 'Votre photo a été refusée : image de mauvaise qualité', 24 * 2, { metadata: { kind: 'CONTENT_REJECTED' } }),
      notif(newCreator.id, NotificationType.SYSTEM, 'Vérification en cours', 'Votre KYC est en cours de vérification. Configurez vos paliers en attendant.', 24, { linkUrl: '/creator/tiers' }),
      // Sophie / Lucas
      notif(sophie.id, NotificationType.SYSTEM, 'Paiement refusé', 'Le renouvellement de votre abonnement chez Claire Rousseau a échoué', 24 * 4, { linkUrl: '/settings/payment-methods', metadata: { kind: 'PAYMENT_FAILED' } }),
      notif(lucas.id, NotificationType.SYSTEM, 'Paiement refusé', 'Votre pourboire de 15,00 € n’a pas pu être envoyé', 48, { metadata: { kind: 'PAYMENT_FAILED' } }),
      // Staff
      notif(admin.id, NotificationType.SYSTEM, 'Rapport de modération', '3 signalements en attente, 1 litige à traiter', 6, { linkUrl: '/admin/moderation', metadata: { kind: 'MODERATION_REPORT' } }),
      notif(moderator.id, NotificationType.SYSTEM, 'Nouveaux signalements', '3 signalements attendent une décision', 6, { linkUrl: '/admin/reports' }),
    ],
  });

  // ---------- Derived counters ----------
  console.log('🧮 Compteurs');
  for (const content of await prisma.content.findMany({ select: { id: true } })) {
    const [likeCount, commentCount] = await Promise.all([
      prisma.contentLike.count({ where: { contentId: content.id } }),
      prisma.comment.count({ where: { contentId: content.id, deletedAt: null } }),
    ]);
    await prisma.content.update({ where: { id: content.id }, data: { likeCount, commentCount } });
  }

  for (const creator of [alice, bob, claire, newCreator]) {
    const [totalSubscribers, totalContent, earnings] = await Promise.all([
      prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE, tier: { creatorId: creator.id } } }),
      prisma.content.count({ where: { creatorId: creator.id, status: ContentStatus.PUBLISHED, deletedAt: null } }),
      prisma.transaction.aggregate({
        where: { toUserId: creator.id, status: TransactionStatus.COMPLETED, type: { in: [TransactionType.SUBSCRIPTION, TransactionType.TIP, TransactionType.PPV_UNLOCK] } },
        _sum: { netAmount: true },
      }),
    ]);
    await prisma.creatorProfile.update({
      where: { userId: creator.id },
      data: { totalSubscribers, totalContent, totalEarnings: earnings._sum.netAmount ?? 0 },
    });
  }

  for (const profile of await prisma.subscriberProfile.findMany({ select: { userId: true } })) {
    const [spent, totalSubscriptions] = await Promise.all([
      prisma.transaction.aggregate({ where: { fromUserId: profile.userId, status: TransactionStatus.COMPLETED, type: { not: TransactionType.REFUND } }, _sum: { amount: true } }),
      prisma.subscription.count({ where: { subscriberId: profile.userId, status: SubscriptionStatus.ACTIVE } }),
    ]);
    await prisma.subscriberProfile.update({
      where: { userId: profile.userId },
      data: { totalSpent: spent._sum.amount ?? 0, totalSubscriptions },
    });
  }

  // ---------- Summary ----------
  const counts = await Promise.all([
    prisma.user.count(), prisma.subscriptionTier.count(), prisma.subscription.count(), prisma.content.count(),
    prisma.contentFile.count(), prisma.transaction.count(), prisma.payout.count(), prisma.liveStream.count(),
    prisma.story.count(), prisma.message.count(), prisma.notification.count(), prisma.report.count(),
  ]);
  const labels = ['utilisateurs', 'paliers', 'abonnements', 'contenus', 'fichiers', 'transactions', 'versements', 'lives',
    'stories', 'messages', 'notifications', 'signalements'];
  console.log('\n✅ Seed terminé');
  labels.forEach((label, i) => console.log(`  ${String(counts[i]).padStart(4)} ${label}`));
  console.log(`\n🔐 Mot de passe de tous les comptes : ${SEED_PASSWORD}`);
  console.log('  admin@ofm.com · moderator@ofm.com');
  console.log('  creator@demo.com · creator2@demo.com · creator3@demo.com · newcreator@demo.com');
  console.log('  subscriber@demo.com · subscriber2@demo.com · subscriber3@demo.com');
  console.log(`  2fa@demo.com (TOTP ${SEED_TOTP_SECRET}) · unverified@demo.com · suspended@demo.com · banned@demo.com`);
  console.log('  fan01@demo.com … fan20@demo.com');
  if (!process.env.SEED_STRIPE_ACCOUNT_ID) {
    console.log('\nℹ️  SEED_STRIPE_ACCOUNT_ID non défini : les créateurs n’ont pas de compte Stripe Connect (paiements payants à configurer).');
  }
}

main()
  .catch((error) => {
    console.error('❌ Échec du seed :', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
