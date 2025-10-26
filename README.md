# OFM - Content Creator Monetization Platform

> A secure, scalable platform for content creators to monetize their work through subscriptions, pay-per-view content, and direct fan engagement.

## Features

### For Creators

- **Multi-tier Subscriptions**: FREE, BASIC, PREMIUM, VIP tiers with custom pricing
- **Content Management**: Upload images, videos, and files with automatic processing
- **Pay-Per-View Content**: Monetize exclusive content beyond subscriptions
- **Real-time Messaging**: Direct communication with subscribers via WebSocket
- **Analytics Dashboard**: Track earnings, subscriber growth, and content performance with interactive charts
- **Automated Payouts**: Stripe Connect integration with automatic transfers
- **2FA Security**: TOTP-based two-factor authentication

### For Subscribers

- **Content Feed**: Browse and discover creator content with filtering
- **Subscription Management**: Easy subscription and tier management interface
- **Secure Payments**: Stripe-powered payment processing
- **Real-time Chat**: Direct messaging with favorite creators
- **Personalized Feed**: Content filtered by active subscriptions

### Technical Features

- **Monorepo Architecture**: Turborepo with NestJS backend and Next.js frontend
- **Real-time Communication**: Socket.io for instant messaging and notifications
- **Media Processing**: Automatic image optimization (Sharp) and video transcoding (FFmpeg)
- **Secure Storage**: S3/MinIO with server-side encryption (AES-256)
- **Caching Layer**: Redis for sessions, rate limiting, and job queues
- **Type Safety**: Full TypeScript coverage across frontend and backend
- **E2E Testing**: Comprehensive Playwright tests for critical user flows
- **Production Ready**: Complete AWS infrastructure with Terraform

## Technology Stack

### Backend

- **NestJS 10**: Progressive Node.js framework
- **PostgreSQL 15**: Primary database with Prisma ORM (18 tables)
- **Redis 7**: Caching, sessions, and message queue (Bull)
- **Stripe Connect**: Payment processing and automated payouts
- **Sharp & FFmpeg**: Media processing and optimization
- **Socket.io**: Real-time bidirectional communication
- **JWT**: Authentication with refresh token rotation

### Frontend

- **Next.js 14**: React framework with App Router
- **React Query (TanStack)**: Server state management and caching
- **Zustand**: Client state management
- **TailwindCSS**: Utility-first CSS framework
- **Shadcn/ui**: Accessible React component library
- **Recharts**: Data visualization and analytics charts
- **Socket.io Client**: Real-time features
- **date-fns**: Date manipulation and formatting

### Infrastructure

- **Docker & Docker Compose**: Containerization
- **AWS ECS Fargate**: Serverless container orchestration
- **Terraform**: Infrastructure as Code with modular architecture
- **GitHub Actions**: CI/CD pipeline with automated testing
- **CloudFront**: Global CDN for media delivery
- **Application Load Balancer**: HTTPS termination and traffic distribution
- **CloudWatch**: Logging, monitoring, and alerting

## Project Structure

```
ofm/
├── apps/
│   ├── api/                    # NestJS backend
│   │   ├── src/
│   │   │   ├── auth/           # Authentication & 2FA (JWT + TOTP)
│   │   │   ├── users/          # User management (creators/subscribers)
│   │   │   ├── content/        # Content management & feed
│   │   │   ├── media/          # Media upload & processing
│   │   │   │   ├── processors/ # Sharp (images) & FFmpeg (videos)
│   │   │   │   └── storage/    # S3/MinIO integration
│   │   │   ├── payments/       # Stripe Connect & payouts
│   │   │   ├── subscriptions/  # Multi-tier subscription logic
│   │   │   ├── messaging/      # Real-time messaging (WebSocket)
│   │   │   │   ├── messaging.gateway.ts
│   │   │   │   ├── messaging.service.ts
│   │   │   │   └── messaging.controller.ts
│   │   │   └── common/
│   │   │       └── database/   # Prisma service
│   │   ├── prisma/
│   │   │   └── schema.prisma   # Database schema (18 tables)
│   │   ├── Dockerfile.prod     # Multi-stage production build
│   │   └── package.json
│   │
│   └── web/                    # Next.js 14 frontend
│       ├── app/
│       │   ├── (auth)/         # Authentication pages
│       │   │   ├── login/
│       │   │   └── register/
│       │   └── (app)/          # Authenticated pages
│       │       ├── creator/    # Creator-specific pages
│       │       │   ├── dashboard/      # Main dashboard with stats
│       │       │   ├── upload/         # Content upload interface
│       │       │   ├── analytics/      # Analytics with Recharts
│       │       │   └── subscriptions/  # Tier management
│       │       ├── feed/       # Subscriber content feed
│       │       ├── messages/   # Real-time messaging UI
│       │       └── subscriptions/  # Subscription discovery
│       ├── components/
│       │   ├── ui/             # Shadcn/ui components
│       │   └── navigation.tsx  # Role-based navigation
│       ├── contexts/           # React contexts (auth, etc.)
│       ├── hooks/              # Custom hooks
│       │   └── use-socket.ts   # Socket.io hook
│       ├── lib/
│       │   └── api.ts          # API client with interceptors
│       ├── e2e/                # Playwright E2E tests
│       │   ├── fixtures/
│       │   ├── pages/          # Page Object Models
│       │   ├── auth.spec.ts
│       │   ├── creator-dashboard.spec.ts
│       │   ├── content-upload.spec.ts
│       │   └── subscriber-feed.spec.ts
│       ├── playwright.config.ts
│       ├── Dockerfile.prod     # Multi-stage production build
│       └── package.json
│
├── terraform/                  # Infrastructure as Code
│   ├── main.tf                 # Main configuration
│   ├── variables.tf            # Input variables
│   ├── outputs.tf              # Output values
│   └── modules/                # Terraform modules
│       ├── vpc/                # VPC with public/private subnets
│       ├── rds/                # PostgreSQL RDS
│       ├── elasticache/        # Redis cluster
│       ├── s3/                 # S3 buckets with encryption
│       ├── cloudfront/         # CDN distribution
│       ├── ecs/                # ECS Fargate cluster
│       ├── alb/                # Application Load Balancer
│       ├── route53/            # DNS management
│       └── monitoring/         # CloudWatch dashboards
│
├── .github/
│   └── workflows/
│       └── ci-cd.yml           # Complete CI/CD pipeline
│
├── docs/
│   ├── PHASE1_COMPLETE.md      # Backend implementation docs
│   ├── DEPLOYMENT.md           # Production deployment guide
│   └── COMPLETE_DEVELOPMENT_GUIDE.md  # Full development guide
│
├── docker-compose.yml          # Development environment
├── docker-compose.prod.yml     # Production environment
├── turbo.json                  # Turborepo configuration
├── package.json                # Root package.json
└── README.md                   # This file
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 15
- Redis 7
- Stripe account (test mode)

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/ofm.git
cd ofm
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
# Backend (.env in apps/api/)
cp apps/api/.env.example apps/api/.env

# Frontend (.env.local in apps/web/)
cp apps/web/.env.example apps/web/.env.local
```

Edit the files with your configuration.

4. **Start services with Docker Compose**

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379
- MinIO (S3-compatible) on ports 9000/9001
- MailHog (email testing) on port 8025
- Adminer (database UI) on port 8080

5. **Run database migrations**

```bash
cd apps/api
npx prisma migrate dev
npx prisma db seed  # Optional: seed test data
```

6. **Start development servers**

```bash
# In root directory
npm run dev

# Or individually
npm run dev:api   # API on http://localhost:3001
npm run dev:web   # Web on http://localhost:3000
```

7. **Access the application**

- **Frontend**: http://localhost:3000
- **API**: http://localhost:3001
- **API Documentation**: http://localhost:3001/api/docs
- **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin)
- **MailHog**: http://localhost:8025
- **Adminer**: http://localhost:8080

## Development

### Available Scripts

```bash
# Development
npm run dev              # Start all services with Turbo
npm run dev:api          # Start API only
npm run dev:web          # Start Web only

# Building
npm run build            # Build all apps
npm run build:api        # Build API
npm run build:web        # Build Web

# Testing
npm run test             # Run all tests
npm run test:api         # Run API tests
npm run test:e2e         # Run Playwright E2E tests
npm run test:e2e:ui      # Run E2E tests with Playwright UI
npm run test:e2e:debug   # Debug E2E tests

# Linting & Type Checking
npm run lint             # Lint all code
npm run type-check       # TypeScript type checking

# Database (Prisma)
npm run db:migrate       # Run database migrations
npm run db:studio        # Open Prisma Studio
npm run db:seed          # Seed database with test data
npm run db:reset         # Reset database (careful!)
```

### Environment Variables

#### Backend (apps/api/.env)

```bash
# Database
DATABASE_URL=postgresql://ofm:password@localhost:5432/ofm

# Redis
REDIS_URL=redis://localhost:6379

# JWT Secrets (generate with: openssl rand -base64 64)
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-super-secret-refresh-key

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CONNECT_CLIENT_ID=ca_xxx

# S3/MinIO
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_REGION=eu-west-1
AWS_S3_BUCKET=ofm-media
S3_ENDPOINT=http://localhost:9000  # Remove for AWS S3

# Application
FRONTEND_URL=http://localhost:3000
PORT=3001
NODE_ENV=development
```

#### Frontend (apps/web/.env.local)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Testing

### Unit & Integration Tests

```bash
# Run all tests
npm run test

# Run with coverage
npm run test:cov

# Watch mode
npm run test:watch
```

### E2E Tests with Playwright

```bash
# Install Playwright browsers (first time only)
npx playwright install

# Run all E2E tests
npm run test:e2e

# Run with Playwright UI (interactive)
npm run test:e2e:ui

# Debug mode
npm run test:e2e:debug

# Run specific test file
npx playwright test e2e/auth.spec.ts
```

**Test Coverage:**
- Authentication (login, register, 2FA)
- Creator dashboard and navigation
- Content upload workflow
- Analytics dashboard
- Subscriptions management
- Subscriber feed and content viewing
- Real-time messaging

## Deployment

### Quick Deploy with Docker Compose

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d
```

### Deploy to AWS with Terraform

See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed instructions.

```bash
cd terraform

# Initialize Terraform
terraform init

# Review changes
terraform plan

# Apply infrastructure
terraform apply
```

**Infrastructure created:**
- VPC with public/private subnets across 3 AZs
- RDS PostgreSQL 15 with Multi-AZ
- ElastiCache Redis cluster
- S3 bucket with encryption
- CloudFront CDN distribution
- ECS Fargate cluster with auto-scaling
- Application Load Balancer with HTTPS
- Route53 DNS records
- CloudWatch monitoring and alarms

**Estimated monthly cost**: $470-620

## Architecture

### Database Schema (18 Tables)

**Core Tables:**
- `User` - User accounts (creators and subscribers)
- `CreatorProfile` - Creator-specific data
- `SubscriberProfile` - Subscriber-specific data
- `Content` - Content posts
- `ContentFile` - Media files for content
- `Media` - Media metadata and processing status

**Subscription System:**
- `SubscriptionTier` - Tier configurations
- `Subscription` - Active subscriptions
- `Transaction` - Payment transactions
- `Payout` - Creator payouts

**Messaging:**
- `Conversation` - Conversation metadata
- `Message` - Chat messages

**Supporting:**
- `Notification` - User notifications
- `Webhook` - Stripe webhook logs
- `RefreshToken` - JWT refresh tokens

### API Endpoints

#### Authentication (`/api/v1/auth`)
- `POST /register` - User registration
- `POST /login` - User login (with optional 2FA)
- `POST /refresh` - Refresh access token
- `POST /logout` - Logout and invalidate tokens
- `GET /me` - Get current user
- `POST /2fa/enable` - Enable 2FA and get QR code
- `POST /2fa/verify` - Verify 2FA code
- `POST /2fa/disable` - Disable 2FA

#### Users (`/api/v1/users`)
- `GET /me` - Get user profile
- `GET /:username` - Get user by username
- `PUT /profile` - Update profile
- `GET /stats` - Get user statistics

#### Content (`/api/v1/content`)
- `GET /feed` - Get public content feed
- `GET /feed/subscriptions` - Get subscriptions feed
- `GET /my-content` - Get own content
- `POST /` - Create new content
- `GET /:id` - Get content by ID
- `PUT /:id` - Update content
- `DELETE /:id` - Delete content
- `POST /:id/like` - Like/unlike content
- `POST /:id/unlock` - Unlock PPV content

#### Media (`/api/v1/media`)
- `POST /upload` - Upload media file
- `GET /signed-url/:id` - Get signed URL for media
- `DELETE /:id` - Delete media

#### Payments (`/api/v1/payments`)
- `POST /connect/create` - Create Stripe Connect account
- `GET /connect/onboarding-link` - Get onboarding link
- `GET /connect/status` - Get onboarding status
- `GET /earnings` - Get earnings summary
- `GET /creator/earnings` - Get detailed creator earnings
- `GET /transactions` - Get transaction history
- `POST /payout/request` - Request payout
- `GET /payouts` - Get payout history

#### Subscriptions (`/api/v1/subscriptions`)
- `GET /my-subscriptions` - Get my subscriptions
- `GET /my-subscribers` - Get my subscribers
- `GET /creator/:id/tiers` - Get creator tiers
- `POST /subscribe` - Subscribe to creator

#### Messages (`/api/v1/messages`)
- `GET /conversations` - Get conversations
- `GET /:partnerId` - Get messages with partner
- `DELETE /:messageId` - Delete message

**WebSocket** (`/messaging`)
- `message:send` - Send message
- `message:typing` - Typing indicator
- `message:read` - Mark as read
- `message:new` - Receive new message
- `message:sent` - Message sent confirmation
- `user:online` / `user:offline` - Online status

## Security

### Authentication & Authorization
- JWT access tokens (15 min expiry)
- Refresh tokens with rotation
- TOTP-based 2FA
- bcrypt password hashing (12 rounds)
- Role-based access control (RBAC)

### Data Protection
- AES-256 encryption at rest (S3)
- TLS 1.3 in transit
- Signed URLs with expiration (1 hour)
- Rate limiting (Redis)
- Input validation (class-validator)
- SQL injection protection (Prisma)

### Security Headers
- Content Security Policy (CSP)
- HTTP Strict Transport Security (HSTS)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff

### Media Security
- Signed URLs for private content
- Automatic watermarking
- EXIF data stripping
- Malware scanning (planned)

## Performance

### Caching Strategy
- Redis for API responses
- CloudFront CDN for media
- React Query client-side cache
- Database connection pooling

### Optimizations
- Image optimization with Sharp
- Video transcoding with FFmpeg
- Lazy loading and code splitting
- Database indexes on frequently queried fields
- Bull queues for async processing

### Monitoring
- CloudWatch for infrastructure metrics
- Sentry for error tracking
- Custom performance dashboards
- Health check endpoints

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Commit Convention**: Use conventional commits (feat, fix, docs, style, refactor, test, chore)

## Roadmap

**Phase 1 (Completed):**
- ✅ Backend API with NestJS
- ✅ Authentication with 2FA
- ✅ Media upload and processing
- ✅ Stripe Connect integration
- ✅ Frontend with Next.js
- ✅ Real-time messaging
- ✅ Analytics dashboard
- ✅ E2E testing
- ✅ Production deployment setup

**Phase 2 (Planned):**
- [ ] Mobile apps (React Native)
- [ ] Live streaming (WebRTC)
- [ ] Advanced content moderation (AI)
- [ ] Multi-language support (i18n)
- [ ] NFT integration
- [ ] Advanced analytics (ML predictions)
- [ ] Creator collaboration features
- [ ] Referral/affiliate program

## License

MIT License - see [LICENSE](./LICENSE) file for details

## Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/yourusername/ofm/issues)
- **Email**: support@ofm-platform.com

## Acknowledgments

- Built with [NestJS](https://nestjs.com/) and [Next.js](https://nextjs.org/)
- UI components from [Shadcn/ui](https://ui.shadcn.com/)
- Icons from [Lucide](https://lucide.dev/)
- Charts from [Recharts](https://recharts.org/)
- Testing with [Playwright](https://playwright.dev/)
- Infrastructure with [Terraform](https://terraform.io/)

---

**Made with ❤️ for content creators worldwide**
