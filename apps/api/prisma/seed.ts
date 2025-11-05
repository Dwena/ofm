import { PrismaClient, UserRole, UserStatus, KycStatus, ContentType, ContentVisibility, ContentStatus, SubscriptionStatus, TransactionType, TransactionStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting comprehensive database seeding...');

  // Clear existing data (in development only!)
  if (process.env.NODE_ENV === 'development') {
    console.log('🧹 Cleaning existing data...');
    await prisma.$executeRaw`TRUNCATE TABLE "StreamMessage" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "StreamViewer" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "LiveStream" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "StoryView" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Story" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "ContentLike" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Comment" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Report" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Notification" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Message" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Conversation" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Transaction" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Payout" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Subscription" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "ContentFile" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Content" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "SubscriptionTier" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "RefreshToken" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "Session" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "SubscriberProfile" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "CreatorProfile" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
  }

  // Hash password
  const hashedPassword = await bcrypt.hash('SecurePass123!', 12);

  // Create Admin User
  console.log('👤 Creating admin user...');
  const admin = await prisma.user.create({
    data: {
      email: 'admin@ofm.com',
      username: 'admin',
      password: hashedPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      displayName: 'Administrateur',
      bio: 'Compte administrateur de la plateforme OFM',
    },
  });

  // Create Creator Users
  console.log('👨‍🎨 Creating creator users...');

  const creator1 = await prisma.user.create({
    data: {
      email: 'creator@demo.com',
      username: 'demo_creator',
      password: hashedPassword,
      role: UserRole.CREATOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      displayName: 'Alice Martin',
      bio: 'Créatrice de contenu lifestyle et voyage. Partage mes aventures autour du monde! 🌍✈️',
      avatar: 'https://i.pravatar.cc/300?img=1',
      coverImage: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1',
      location: 'Paris, France',
      website: 'https://alice-martin.com',
      kycStatus: KycStatus.VERIFIED,
      kycVerifiedAt: new Date(),
      stripeOnboarded: true,
      creatorProfile: {
        create: {
          totalEarnings: 5420.50,
          totalSubscribers: 156,
          totalContent: 48,
          averageRating: 4.8,
          allowMessages: true,
          allowTips: true,
          minimumTip: 5,
          welcomeMessage: 'Bienvenue dans ma communauté! Merci pour ton soutien 💖',
        },
      },
    },
  });

  const creator2 = await prisma.user.create({
    data: {
      email: 'creator2@demo.com',
      username: 'creator_fitness',
      password: hashedPassword,
      role: UserRole.CREATOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      displayName: 'Bob Dupont',
      bio: 'Coach fitness & nutrition. Transforme ton corps et ton esprit! 💪🥗',
      avatar: 'https://i.pravatar.cc/300?img=12',
      coverImage: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48',
      location: 'Lyon, France',
      website: 'https://bob-fitness.com',
      kycStatus: KycStatus.VERIFIED,
      kycVerifiedAt: new Date(),
      stripeOnboarded: true,
      creatorProfile: {
        create: {
          totalEarnings: 8930.75,
          totalSubscribers: 234,
          totalContent: 87,
          averageRating: 4.9,
          allowMessages: true,
          allowTips: true,
          minimumTip: 10,
          welcomeMessage: 'Salut champion! Prêt à transformer ta vie? Let\'s go! 🔥',
        },
      },
    },
  });

  const creator3 = await prisma.user.create({
    data: {
      email: 'creator3@demo.com',
      username: 'creator_art',
      password: hashedPassword,
      role: UserRole.CREATOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      displayName: 'Charlotte Leclerc',
      bio: 'Artiste digitale & designer. Créations exclusives et tutoriels créatifs 🎨✨',
      avatar: 'https://i.pravatar.cc/300?img=5',
      coverImage: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab',
      location: 'Marseille, France',
      kycStatus: KycStatus.VERIFIED,
      kycVerifiedAt: new Date(),
      stripeOnboarded: true,
      creatorProfile: {
        create: {
          totalEarnings: 3210.25,
          totalSubscribers: 98,
          totalContent: 32,
          averageRating: 4.7,
          allowMessages: true,
          allowTips: true,
          minimumTip: 5,
          welcomeMessage: 'Merci de rejoindre ma communauté créative! 🎨',
        },
      },
    },
  });

  // Create Subscriber Users
  console.log('👥 Creating subscriber users...');

  const subscriber1 = await prisma.user.create({
    data: {
      email: 'subscriber@demo.com',
      username: 'demo_subscriber',
      password: hashedPassword,
      role: UserRole.SUBSCRIBER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      displayName: 'David Bernard',
      avatar: 'https://i.pravatar.cc/300?img=13',
      subscriberProfile: {
        create: {
          totalSpent: 150.00,
          totalSubscriptions: 3,
        },
      },
    },
  });

  const subscriber2 = await prisma.user.create({
    data: {
      email: 'subscriber2@demo.com',
      username: 'sub_emma',
      password: hashedPassword,
      role: UserRole.SUBSCRIBER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      displayName: 'Emma Petit',
      avatar: 'https://i.pravatar.cc/300?img=9',
      subscriberProfile: {
        create: {
          totalSpent: 280.50,
          totalSubscriptions: 2,
        },
      },
    },
  });

  // Create Subscription Tiers
  console.log('💎 Creating subscription tiers...');

  const tier1_bronze = await prisma.subscriptionTier.create({
    data: {
      creatorId: creator1.id,
      name: 'Bronze',
      description: 'Accès au contenu exclusif de base',
      price: 9.99,
      currency: 'EUR',
      interval: 'month',
      benefits: [
        'Accès au contenu photo exclusif',
        'Participations aux sondages',
        'Badge membre Bronze',
      ],
      isActive: true,
    },
  });

  const tier1_silver = await prisma.subscriptionTier.create({
    data: {
      creatorId: creator1.id,
      name: 'Silver',
      description: 'Tout du Bronze + vidéos exclusives',
      price: 19.99,
      currency: 'EUR',
      interval: 'month',
      benefits: [
        'Tout du Bronze',
        'Accès aux vidéos exclusives',
        'Messages directs prioritaires',
        'Badge membre Silver',
      ],
      isActive: true,
    },
  });

  const tier2_basic = await prisma.subscriptionTier.create({
    data: {
      creatorId: creator2.id,
      name: 'Basic',
      description: 'Programmes d\'entraînement de base',
      price: 14.99,
      currency: 'EUR',
      interval: 'month',
      benefits: [
        '3 programmes d\'entraînement',
        'Conseils nutrition',
        'Accès au groupe privé',
      ],
      isActive: true,
    },
  });

  const tier2_pro = await prisma.subscriptionTier.create({
    data: {
      creatorId: creator2.id,
      name: 'Pro',
      description: 'Coaching personnalisé',
      price: 49.99,
      currency: 'EUR',
      interval: 'month',
      benefits: [
        'Tout du Basic',
        'Programme personnalisé',
        '1 session coaching/mois',
        'Suivi hebdomadaire',
      ],
      isActive: true,
    },
  });

  const tier3_fan = await prisma.subscriptionTier.create({
    data: {
      creatorId: creator3.id,
      name: 'Fan',
      description: 'Support de base pour mes créations',
      price: 7.99,
      currency: 'EUR',
      interval: 'month',
      benefits: [
        'Accès au contenu exclusif',
        'Tutoriels de base',
      ],
      isActive: true,
    },
  });

  // Create Subscriptions
  console.log('📝 Creating subscriptions...');

  await prisma.subscription.createMany({
    data: [
      {
        subscriberId: subscriber1.id,
        tierId: tier1_bronze.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        subscriberId: subscriber2.id,
        tierId: tier1_silver.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        subscriberId: subscriber1.id,
        tierId: tier2_basic.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    ],
  });

  // Create Content
  console.log('📸 Creating content...');

  const contents = await Promise.all([
    prisma.content.create({
      data: {
        creatorId: creator1.id,
        type: ContentType.PHOTO,
        title: 'Coucher de soleil à Santorini',
        description: 'Une magnifique soirée en Grèce 🇬🇷',
        visibility: ContentVisibility.SUBSCRIBERS_ONLY,
        status: ContentStatus.PUBLISHED,
        viewCount: 145,
        likeCount: 23,
        commentCount: 8,
        publishedAt: new Date(),
      },
    }),
    prisma.content.create({
      data: {
        creatorId: creator1.id,
        type: ContentType.VIDEO,
        title: 'Vlog: Une journée à Paris',
        description: 'Suivez-moi pour une journée complète dans la capitale!',
        visibility: ContentVisibility.PUBLIC,
        status: ContentStatus.PUBLISHED,
        viewCount: 512,
        likeCount: 67,
        commentCount: 24,
        publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    }),
    prisma.content.create({
      data: {
        creatorId: creator2.id,
        type: ContentType.VIDEO,
        title: 'Programme HIIT 20 minutes',
        description: 'Entraînement intensif pour brûler un maximum de calories! 🔥',
        visibility: ContentVisibility.PREMIUM_SUBSCRIBERS,
        status: ContentStatus.PUBLISHED,
        viewCount: 328,
        likeCount: 89,
        commentCount: 15,
        publishedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    }),
    prisma.content.create({
      data: {
        creatorId: creator2.id,
        type: ContentType.PHOTO,
        title: 'Transformation avant/après',
        description: 'Les résultats de mon client après 3 mois! 💪',
        visibility: ContentVisibility.PUBLIC,
        status: ContentStatus.PUBLISHED,
        viewCount: 892,
        likeCount: 156,
        commentCount: 42,
        publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    }),
    prisma.content.create({
      data: {
        creatorId: creator3.id,
        type: ContentType.PHOTO,
        title: 'Digital art - Abstract #42',
        description: 'Nouvelle création digitale! Qu\'en pensez-vous? 🎨',
        visibility: ContentVisibility.PUBLIC,
        status: ContentStatus.PUBLISHED,
        viewCount: 234,
        likeCount: 45,
        commentCount: 12,
        publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    }),
  ]);

  // Create Likes
  console.log('❤️ Creating likes...');
  await prisma.contentLike.createMany({
    data: [
      { userId: subscriber1.id, contentId: contents[0].id },
      { userId: subscriber2.id, contentId: contents[0].id },
      { userId: subscriber1.id, contentId: contents[1].id },
      { userId: subscriber2.id, contentId: contents[2].id },
      { userId: subscriber1.id, contentId: contents[3].id },
      { userId: subscriber2.id, contentId: contents[4].id },
    ],
  });

  // Create Comments
  console.log('💬 Creating comments...');
  await prisma.comment.createMany({
    data: [
      {
        userId: subscriber1.id,
        contentId: contents[0].id,
        text: 'Magnifique photo! J\'aimerais tellement visiter la Grèce! 😍',
      },
      {
        userId: subscriber2.id,
        contentId: contents[1].id,
        text: 'Super vlog! Ça donne envie de découvrir Paris!',
      },
      {
        userId: subscriber1.id,
        contentId: contents[2].id,
        text: 'J\'ai fait le programme, c\'est intense mais efficace! 💪',
      },
      {
        userId: subscriber2.id,
        contentId: contents[3].id,
        text: 'Incroyable transformation! Bravo! 🎉',
      },
      {
        userId: subscriber1.id,
        contentId: contents[4].id,
        text: 'J\'adore ton style artistique!',
      },
    ],
  });

  // Create Transactions
  console.log('💰 Creating transactions...');
  await prisma.transaction.createMany({
    data: [
      {
        fromUserId: subscriber1.id,
        toUserId: creator1.id,
        type: TransactionType.SUBSCRIPTION,
        amount: 9.99,
        platformFee: 1.50,
        netAmount: 8.49,
        status: TransactionStatus.COMPLETED,
        stripePaymentIntentId: 'pi_test_' + Math.random().toString(36).substring(7),
      },
      {
        fromUserId: subscriber2.id,
        toUserId: creator1.id,
        type: TransactionType.TIP,
        amount: 25.00,
        platformFee: 3.75,
        netAmount: 21.25,
        status: TransactionStatus.COMPLETED,
        stripePaymentIntentId: 'pi_test_' + Math.random().toString(36).substring(7),
        metadata: { message: 'Merci pour ton contenu incroyable!' },
      },
      {
        fromUserId: subscriber1.id,
        toUserId: creator2.id,
        type: TransactionType.SUBSCRIPTION,
        amount: 14.99,
        platformFee: 2.25,
        netAmount: 12.74,
        status: TransactionStatus.COMPLETED,
        stripePaymentIntentId: 'pi_test_' + Math.random().toString(36).substring(7),
      },
      {
        fromUserId: subscriber2.id,
        toUserId: creator2.id,
        type: TransactionType.TIP,
        amount: 50.00,
        platformFee: 7.50,
        netAmount: 42.50,
        status: TransactionStatus.COMPLETED,
        stripePaymentIntentId: 'pi_test_' + Math.random().toString(36).substring(7),
        metadata: { message: 'Keep up the great work!' },
      },
    ],
  });

  // Create Stories
  console.log('📱 Creating stories...');
  const now = new Date();

  await prisma.story.createMany({
    data: [
      {
        creatorId: creator1.id,
        type: 'PHOTO',
        mediaUrl: 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba',
        caption: 'En direct de mon voyage! 🌴',
        expiresAt: new Date(now.getTime() + 22 * 60 * 60 * 1000),
        viewCount: 45,
      },
      {
        creatorId: creator2.id,
        type: 'VIDEO',
        mediaUrl: 'https://example.com/workout-snippet.mp4',
        caption: 'Nouvelle routine du matin! 💪',
        expiresAt: new Date(now.getTime() + 20 * 60 * 60 * 1000),
        viewCount: 78,
      },
      {
        creatorId: creator3.id,
        type: 'PHOTO',
        mediaUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe',
        caption: 'Work in progress... 🎨✨',
        expiresAt: new Date(now.getTime() + 18 * 60 * 60 * 1000),
        viewCount: 34,
      },
    ],
  });

  console.log('✅ Seeding completed successfully!');
  console.log('\n📊 Summary:');
  console.log(`  - ${await prisma.user.count()} users created`);
  console.log(`  - ${await prisma.subscriptionTier.count()} subscription tiers`);
  console.log(`  - ${await prisma.subscription.count()} active subscriptions`);
  console.log(`  - ${await prisma.content.count()} content items`);
  console.log(`  - ${await prisma.contentLike.count()} likes`);
  console.log(`  - ${await prisma.comment.count()} comments`);
  console.log(`  - ${await prisma.transaction.count()} transactions`);
  console.log(`  - ${await prisma.story.count()} stories`);
  console.log('\n🔐 Test Accounts (password: SecurePass123!):');
  console.log('  Admin:      admin@ofm.com');
  console.log('  Creator 1:  creator@demo.com');
  console.log('  Creator 2:  creator2@demo.com');
  console.log('  Creator 3:  creator3@demo.com');
  console.log('  Subscriber 1: subscriber@demo.com');
  console.log('  Subscriber 2: subscriber2@demo.com');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
