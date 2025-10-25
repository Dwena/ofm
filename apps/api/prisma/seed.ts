import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Hash password
  const hashedPassword = await bcrypt.hash('SecurePass123!', 12);

  // Create demo creator
  const creator = await prisma.user.upsert({
    where: { email: 'creator@demo.com' },
    update: {},
    create: {
      email: 'creator@demo.com',
      username: 'demo_creator',
      password: hashedPassword,
      role: 'CREATOR',
      status: 'ACTIVE',
      displayName: 'Demo Creator',
      bio: 'This is a demo creator account for testing purposes.',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      creatorProfile: {
        create: {
          totalEarnings: 0,
          totalSubscribers: 0,
          totalContent: 0,
          averageRating: 0,
        },
      },
    },
  });

  console.log('✅ Created demo creator:', creator.username);

  // Create demo subscriber
  const subscriber = await prisma.user.upsert({
    where: { email: 'subscriber@demo.com' },
    update: {},
    create: {
      email: 'subscriber@demo.com',
      username: 'demo_subscriber',
      password: hashedPassword,
      role: 'SUBSCRIBER',
      status: 'ACTIVE',
      displayName: 'Demo Subscriber',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      subscriberProfile: {
        create: {
          totalSpent: 0,
          totalSubscriptions: 0,
        },
      },
    },
  });

  console.log('✅ Created demo subscriber:', subscriber.username);

  // Create subscription tiers for creator
  const tier1 = await prisma.subscriptionTier.create({
    data: {
      creatorId: creator.id,
      name: 'Basic',
      description: 'Access to all public content',
      price: 9.99,
      currency: 'EUR',
      interval: 'month',
      benefits: ['Access to all posts', 'Monthly updates', 'Community access'],
      isActive: true,
    },
  });

  const tier2 = await prisma.subscriptionTier.create({
    data: {
      creatorId: creator.id,
      name: 'Premium',
      description: 'Access to all content including exclusive posts',
      price: 19.99,
      currency: 'EUR',
      interval: 'month',
      benefits: [
        'All Basic benefits',
        'Exclusive content',
        'Direct messaging',
        'Early access to new content',
      ],
      isActive: true,
    },
  });

  console.log('✅ Created subscription tiers:', tier1.name, tier2.name);

  // Create demo admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ofm.com' },
    update: {},
    create: {
      email: 'admin@ofm.com',
      username: 'admin',
      password: hashedPassword,
      role: 'ADMIN',
      status: 'ACTIVE',
      displayName: 'OFM Admin',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  console.log('✅ Created admin user:', admin.username);

  console.log('\n🎉 Database seeded successfully!');
  console.log('\n📝 Demo accounts:');
  console.log('Creator: creator@demo.com / SecurePass123!');
  console.log('Subscriber: subscriber@demo.com / SecurePass123!');
  console.log('Admin: admin@ofm.com / SecurePass123!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
