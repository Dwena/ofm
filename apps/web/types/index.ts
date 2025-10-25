export type UserRole = 'CREATOR' | 'SUBSCRIBER' | 'ADMIN' | 'MODERATOR'

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'PENDING_VERIFICATION'

export interface User {
  id: string
  email: string
  username: string
  role: UserRole
  status: UserStatus
  displayName?: string
  bio?: string
  avatar?: string
  coverImage?: string
  location?: string
  website?: string
  emailVerified: boolean
  phoneVerified: boolean
  twoFactorEnabled: boolean
  kycStatus: string
  createdAt: string
  lastActiveAt?: string
  creatorProfile?: CreatorProfile
  subscriberProfile?: SubscriberProfile
}

export interface CreatorProfile {
  id: string
  userId: string
  totalEarnings: number
  totalSubscribers: number
  totalContent: number
  averageRating: number
  allowMessages: boolean
  allowTips: boolean
  autoAcceptSubscribers: boolean
  welcomeMessage?: string
  minimumTip: number
}

export interface SubscriberProfile {
  id: string
  userId: string
  totalSpent: number
  totalSubscriptions: number
  autoRenewSubscriptions: boolean
}

export interface SubscriptionTier {
  id: string
  creatorId: string
  name: string
  description?: string
  price: number
  currency: string
  interval: 'month' | 'year'
  benefits: string[]
  stripePriceId?: string
  stripeProductId?: string
  isActive: boolean
  createdAt: string
}

export interface Subscription {
  id: string
  subscriberId: string
  tierId: string
  status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE' | 'PAUSED'
  stripeSubscriptionId?: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelledAt?: string
  cancelAtPeriodEnd: boolean
  createdAt: string
  tier: SubscriptionTier
}

export interface Content {
  id: string
  creatorId: string
  type: 'PHOTO' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'ALBUM'
  visibility: 'PUBLIC' | 'SUBSCRIBERS_ONLY' | 'PREMIUM_SUBSCRIBERS' | 'PPV' | 'PRIVATE'
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'UNDER_REVIEW' | 'REJECTED'
  title?: string
  description?: string
  caption?: string
  files: ContentFile[]
  isPpv: boolean
  ppvPrice?: number
  viewCount: number
  likeCount: number
  commentCount: number
  publishedAt?: string
  createdAt: string
  creator: Pick<User, 'id' | 'username' | 'displayName' | 'avatar'>
}

export interface ContentFile {
  id: string
  contentId: string
  filename: string
  originalName: string
  mimeType: string
  size: number
  storagePath: string
  thumbnailPath?: string
  width?: number
  height?: number
  duration?: number
  isEncrypted: boolean
  hasWatermark: boolean
  order: number
  createdAt: string
}

export interface Message {
  id: string
  senderId: string
  receiverId: string
  content: string
  hasAttachment: boolean
  attachmentUrl?: string
  status: 'SENT' | 'DELIVERED' | 'READ' | 'DELETED'
  readAt?: string
  isPpv: boolean
  ppvPrice?: number
  isPurchased: boolean
  createdAt: string
  sender: Pick<User, 'id' | 'username' | 'displayName' | 'avatar'>
  receiver: Pick<User, 'id' | 'username' | 'displayName' | 'avatar'>
}

export interface Transaction {
  id: string
  fromUserId: string
  toUserId?: string
  type: 'SUBSCRIPTION' | 'TIP' | 'PPV_UNLOCK' | 'PAYOUT' | 'REFUND' | 'PLATFORM_FEE'
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REFUNDED'
  amount: number
  currency: string
  platformFee: number
  netAmount: number
  stripePaymentIntentId?: string
  createdAt: string
  fromUser: Pick<User, 'id' | 'username' | 'displayName' | 'avatar'>
  toUser?: Pick<User, 'id' | 'username' | 'displayName' | 'avatar'>
}

export interface Payout {
  id: string
  userId: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  amount: number
  currency: string
  stripePayoutId?: string
  destinationType: string
  destination?: string
  requestedAt: string
  processedAt?: string
  completedAt?: string
  failedAt?: string
  failureReason?: string
  createdAt: string
}

export interface Notification {
  id: string
  userId: string
  type: 'NEW_SUBSCRIBER' | 'NEW_MESSAGE' | 'NEW_TIP' | 'NEW_COMMENT' | 'SUBSCRIPTION_RENEWAL' | 'PAYOUT_COMPLETED' | 'CONTENT_APPROVED' | 'CONTENT_REJECTED' | 'SYSTEM'
  title: string
  message: string
  linkUrl?: string
  isRead: boolean
  readAt?: string
  createdAt: string
}

export interface Earnings {
  totalEarnings: number
  monthlyEarnings: number
  pendingBalance: number
  totalPayouts: number
  availableForPayout: number
}

export interface ApiResponse<T> {
  success: boolean
  statusCode: number
  data: T
  timestamp: string
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}
