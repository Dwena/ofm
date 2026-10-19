import axios, { AxiosError, AxiosResponse } from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - Add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// The API wraps every payload as { success, statusCode, data, timestamp }.
// Unwrap it so callers can read `response.data` as the payload itself.
function unwrapEnvelope(response: AxiosResponse) {
  const body = response.data
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    response.data = body.data
  }
  return response
}

// Response interceptor - Unwrap envelope, handle errors and token refresh
api.interceptors.response.use(
  unwrapEnvelope,
  async (error: AxiosError) => {
    const originalRequest = error.config as any

    // If 401 and not already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        const refreshToken = localStorage.getItem('refreshToken')
        if (!refreshToken) {
          throw new Error('No refresh token')
        }

        const response = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
          refreshToken,
        })

        const { accessToken, refreshToken: newRefreshToken } = response.data.data

        localStorage.setItem('accessToken', accessToken)
        localStorage.setItem('refreshToken', newRefreshToken)

        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        // Refresh failed - logout user
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        localStorage.removeItem('user')
        window.location.href = '/login'
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

// API methods
export const authApi = {
  register: (data: { email: string; username: string; password: string; role?: string }) =>
    api.post('/auth/register', data),
  // `_retry: true` stops the 401 interceptor from trying a token refresh (and
  // redirecting to /login) when the credentials or the 2FA code are wrong.
  login: (data: { email: string; password: string; totpCode?: string }) =>
    api.post('/auth/login', data, { _retry: true } as any),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  enable2FA: () => api.post('/auth/2fa/enable'),
  verify2FA: (code: string) => api.post('/auth/2fa/verify', { code }),
  disable2FA: (code: string) => api.post('/auth/2fa/disable', { code }),
  verifyEmail: (token: string) => api.post('/auth/verify-email', { token }),
  resendVerification: (email: string) => api.post('/auth/resend-verification', { email }),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),
}

export const pushApi = {
  getVapidPublicKey: () =>
    api.get<{ publicKey: string | null; enabled: boolean }>('/notifications/push/vapid-public-key'),
  subscribe: (subscription: PushSubscriptionJSON) =>
    api.post('/notifications/push/subscribe', {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? undefined,
      keys: subscription.keys,
    }),
  unsubscribe: (endpoint: string) =>
    api.delete('/notifications/push/unsubscribe', { data: { endpoint } }),
}

export const usersApi = {
  getMe: () => api.get('/users/me'),
  getProfile: () => api.get('/users/me'),
  getByUsername: (username: string) => api.get(`/users/${username}`),
  updateProfile: (data: any) => api.put('/users/profile', data),
  getStats: () => api.get('/users/stats'),
  // Maps the /social/discover/creators response to the discover page's creator shape
  discover: async (params: { search?: string; category?: string; sortBy?: string; page?: number; limit?: number } = {}) => {
    const sortMap: Record<string, 'POPULAR' | 'NEW' | 'RECOMMENDED'> = {
      popular: 'POPULAR',
      subscribers: 'POPULAR',
      recent: 'NEW',
    }
    const response = await api.get('/social/discover/creators', {
      params: {
        query: params.search || undefined,
        sortBy: params.sortBy ? sortMap[params.sortBy] ?? 'RECOMMENDED' : undefined,
        page: params.page,
        limit: params.limit,
      },
    })
    const items: any[] = Array.isArray(response.data?.items) ? response.data.items : []
    return {
      ...response,
      data: items.map((creator) => ({
        ...creator,
        subscriberCount: creator.creatorProfile?.totalSubscribers ?? 0,
        postCount: creator.creatorProfile?.totalContent ?? 0,
        subscriptionPrice: creator.subscriptionPrice ?? undefined,
        isVerified: creator.kycStatus === 'VERIFIED',
        categories: [],
      })),
    }
  },
}

export const mediaApi = {
  upload: (formData: FormData, config?: any) =>
    api.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      ...config,
    }),
  uploadImage: (fileOrFormData: File | FormData) => {
    const formData = fileOrFormData instanceof FormData ? fileOrFormData : new FormData()
    if (fileOrFormData instanceof File) formData.append('file', fileOrFormData)
    return api.post('/media/upload/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  uploadVideo: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/media/upload/video', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  getSignedUrl: (contentFileId: string) =>
    api.get(`/media/signed-url/${contentFileId}`),
  deleteMedia: (contentFileId: string) =>
    api.delete(`/media/${contentFileId}`),
}

export const paymentsApi = {
  createConnectAccount: () => api.post('/payments/connect/create'),
  getOnboardingLink: () => api.get('/payments/connect/onboarding-link'),
  getOnboardingStatus: () => api.get('/payments/connect/status'),
  requestPayout: (amount: number) => api.post('/payments/payout/request', { amount }),
  getEarnings: () => api.get('/payments/earnings'),
  getCreatorEarnings: () => api.get('/payments/creator/earnings'),
  getTransactions: (page: number = 1, limit: number = 20) =>
    api.get(`/payments/transactions?page=${page}&limit=${limit}`),
  getPayouts: () => api.get('/payments/payouts'),
  sendTip: (creatorId: string, amount: number, message?: string) =>
    api.post(`/payments/tip/${creatorId}`, { amount, message }),
  createPaymentIntent: (data: { amount: number; currency?: string }) =>
    api.post('/payments/create-intent', data),
  getFilteredTransactions: (filters: any) =>
    api.get('/payments/transactions/filter', { params: filters }),
  createRefund: (data: { transactionId: string; amount?: number; reason?: string }) =>
    api.post('/payments/refund', data),
  getRefunds: (page: number = 1, limit: number = 20) =>
    api.get(`/payments/refunds?page=${page}&limit=${limit}`),
  getRevenueStats: (filters: any) =>
    api.get('/payments/stats/revenue', { params: filters }),
  // Saved payment methods (cards)
  getPaymentMethods: () => api.get('/payments/methods'),
  createSetupIntent: () => api.post('/payments/methods/setup-intent'),
  setDefaultPaymentMethod: (paymentMethodId: string) =>
    api.post(`/payments/methods/${paymentMethodId}/default`),
  deletePaymentMethod: (paymentMethodId: string) =>
    api.delete(`/payments/methods/${paymentMethodId}`),
}

export const subscriptionsApi = {
  getMySubscriptions: () => api.get('/subscriptions/my-subscriptions'),
  getMySubscribers: () => api.get('/subscriptions/my-subscribers'),
  getCreatorTiers: (creatorId: string) =>
    api.get(`/subscriptions/creator/${creatorId}/tiers`),
  // Tier management
  getMyTiers: () => api.get('/subscriptions/my-tiers'),
  createTier: (data: {
    name: string
    description?: string
    price: number
    currency?: string
    interval?: string
    benefits?: string[]
    isActive?: boolean
  }) => api.post('/subscriptions/tiers', data),
  updateTier: (tierId: string, data: {
    name?: string
    description?: string
    price?: number
    currency?: string
    interval?: string
    benefits?: string[]
    isActive?: boolean
  }) => api.put(`/subscriptions/tiers/${tierId}`, data),
  deleteTier: (tierId: string) => api.delete(`/subscriptions/tiers/${tierId}`),
  // Subscription lifecycle
  getStatusForCreator: (creatorId: string) =>
    api.get(`/subscriptions/creator/${creatorId}/status`),
  // Returns { requiresPayment, subscription?, clientSecret?, stripeSubscriptionId? }
  subscribe: (data: { tierId: string; paymentMethodId?: string }) =>
    api.post('/subscriptions/subscribe', data),
  confirm: (stripeSubscriptionId: string) =>
    api.post('/subscriptions/confirm', { stripeSubscriptionId }),
  cancel: (subscriptionId: string) => api.post(`/subscriptions/${subscriptionId}/cancel`),
  resume: (subscriptionId: string) => api.post(`/subscriptions/${subscriptionId}/resume`),
}

export const contentApi = {
  getFeed: (params: { page?: number; limit?: number } = {}) =>
    api.get('/content/feed', { params }),
  getSubscriptionsFeed: (params: { page?: number; limit?: number } = {}) =>
    api.get('/content/feed/subscriptions', { params }),
  getCreatorContent: (creatorId: string) =>
    api.get(`/content/creator/${creatorId}`),
  getMyContent: (params: { page?: number; limit?: number } = {}) =>
    api.get('/content/my-content', { params }),
  getById: (id: string) => api.get(`/content/${id}`),
  // Created as a draft; call publish() to make it visible
  create: (data: {
    type: 'PHOTO' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'ALBUM'
    visibility?: 'PUBLIC' | 'SUBSCRIBERS_ONLY' | 'PREMIUM_SUBSCRIBERS' | 'PPV' | 'PRIVATE'
    title?: string
    description?: string
    caption?: string
    fileIds?: string[]
    isPpv?: boolean
    ppvPrice?: number // euros
  }) => api.post('/content', data),
  publish: (id: string) => api.post(`/content/${id}/publish`),
  update: (id: string, data: any) => api.put(`/content/${id}`, data),
  delete: (id: string) => api.delete(`/content/${id}`),
  likeContent: (id: string) => api.post(`/content/${id}/like`),
  unlockPPV: (id: string) => api.post(`/content/${id}/unlock`),
}

export const messagesApi = {
  getConversations: () => api.get('/messages/conversations'),
  getMessages: (partnerId: string, params: { page?: number; limit?: number } = {}) =>
    api.get(`/messages/${partnerId}`, { params }),
  deleteMessage: (messageId: string) => api.delete(`/messages/${messageId}`),
}

export const notificationsApi = {
  getAll: (unreadOnly: boolean = false) =>
    api.get('/notifications', { params: { unreadOnly } }),
  markAsRead: (id: string) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/read-all'),
  deleteNotification: (id: string) => api.delete(`/notifications/${id}`),
}

export const socialApi = {
  // Comments
  getComments: (contentId: string, page: number = 1, limit: number = 20) =>
    api.get('/social/comments', { params: { contentId, page, limit } }),
  createComment: (contentId: string, text: string) =>
    api.post('/social/comments', { contentId, text }),
  updateComment: (commentId: string, text: string) =>
    api.put(`/social/comments/${commentId}`, { text }),
  deleteComment: (commentId: string) =>
    api.delete(`/social/comments/${commentId}`),

  // Follow/Unfollow
  followCreator: (creatorId: string) =>
    api.post('/social/follow', { creatorId }),
  unfollowCreator: (creatorId: string) =>
    api.delete(`/social/follow/${creatorId}`),
  getFollowing: () =>
    api.get('/social/following'),

  // Discover
  discoverCreators: (params?: {
    query?: string
    sortBy?: 'POPULAR' | 'NEW' | 'RECOMMENDED'
    page?: number
    limit?: number
  }) => api.get('/social/discover/creators', { params }),

  // Search
  searchCreators: (query: string, limit?: number) =>
    api.get('/social/search', { params: { q: query, limit } }),
}

export const analyticsApi = {
  // Track views
  trackView: (contentId: string, data?: { ipAddress?: string; userAgent?: string }) =>
    api.post('/analytics/track/view', { contentId, ...data }),

  // Get overview analytics
  getOverview: () =>
    api.get('/analytics/overview'),

  // Get content analytics
  getContentAnalytics: (params?: {
    interval?: 'day' | 'week' | 'month' | 'year'
    periods?: number
    startDate?: string
    endDate?: string
    contentId?: string
    contentType?: string
  }) => api.get('/analytics/content', { params }),

  // Get engagement statistics
  getEngagementStats: (params?: {
    interval?: 'day' | 'week' | 'month' | 'year'
    periods?: number
  }) => api.get('/analytics/engagement', { params }),

  // Get subscriber growth
  getSubscriberGrowth: (params?: {
    interval?: 'day' | 'week' | 'month' | 'year'
    periods?: number
    startDate?: string
    endDate?: string
  }) => api.get('/analytics/subscribers/growth', { params }),

  // Get detailed report
  getDetailedReport: (params?: {
    interval?: 'day' | 'week' | 'month' | 'year'
    periods?: number
    startDate?: string
    endDate?: string
  }) => api.get('/analytics/report/detailed', { params }),
}

export const adminApi = {
  getStats: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/admin/stats/platform', { params }),
  getUsers: (params?: { query?: string; role?: string; status?: string; page?: number; limit?: number }) =>
    api.get('/admin/users', { params }),
  getRecentUsers: (limit: number = 5) =>
    api.get('/admin/users', { params: { page: 1, limit } }),
  getUserDetails: (userId: string) => api.get(`/admin/users/${userId}`),
  moderateUser: (data: { userId: string; action: string; reason?: string; durationDays?: number }) =>
    api.post('/admin/users/moderate', data),
  getReports: (params?: { status?: string; type?: string; page?: number; limit?: number }) =>
    api.get('/admin/reports', { params }),
  getPendingReports: (limit: number = 5) =>
    api.get('/admin/reports', { params: { status: 'PENDING', page: 1, limit } }),
  handleReport: (data: {
    reportId: string
    status: 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'REJECTED'
    adminNotes?: string
    action?: 'SUSPEND' | 'BAN' | 'ACTIVATE' | 'WARN'
    durationDays?: number
    removeContent?: boolean
  }) => api.post('/admin/reports/handle', data),
  deleteUser: (userId: string, reason?: string) =>
    api.delete(`/admin/users/${userId}`, { data: { reason } }),
  // Content moderation: filter ALL | FLAGGED (under review / reported) | REMOVED
  getContent: (params?: {
    query?: string
    status?: string
    type?: string
    filter?: 'ALL' | 'FLAGGED' | 'REMOVED'
    page?: number
    limit?: number
  }) => api.get('/admin/content', { params }),
  removeContent: (contentId: string, reason?: string) =>
    api.post(`/admin/content/${contentId}/remove`, { reason }),
  restoreContent: (contentId: string, reason?: string) =>
    api.post(`/admin/content/${contentId}/restore`, { reason }),
  getActivityLogs: (page: number = 1, limit: number = 20) =>
    api.get('/admin/activity-logs', { params: { page, limit } }),
  getAuditLogs: (params?: { action?: string; resource?: string; userId?: string; page?: number; limit?: number }) =>
    api.get('/admin/audit-logs', { params }),
}

export const moderationApi = {
  createReport: (data: { reportedType: string; reportedId: string; reason: string; description?: string }) =>
    api.post('/moderation/reports', data),
  // Statuses are lowercase here: pending | reviewed | resolved | dismissed
  getReportsQueue: (params?: { status?: string; reportedType?: string; page?: number; limit?: number }) =>
    api.get('/moderation/reports/queue', { params }),
  handleReport: (reportId: string, decision: 'RESOLVE' | 'DISMISS' | 'ESCALATE', resolution: string) =>
    api.post(`/moderation/reports/${reportId}/handle`, { decision, resolution }),
  banUser: (userId: string, reason: string) =>
    api.post(`/moderation/users/${userId}/ban`, { reason }),
  suspendUser: (userId: string, reason: string, durationDays: number) =>
    api.post(`/moderation/users/${userId}/suspend`, { reason, durationDays }),
  unsuspendUser: (userId: string) =>
    api.post(`/moderation/users/${userId}/unsuspend`),
}

export const liveApi = {
  getLiveStreams: () => api.get('/streaming/live'),
  getScheduledStreams: () => api.get('/streaming/scheduled'),
  getCreatorStreams: (creatorId: string) => api.get(`/streaming/creator/${creatorId}`),
  getStream: (streamId: string) => api.get(`/streaming/${streamId}`),
  // Without scheduledFor the stream goes live immediately; with it, it is SCHEDULED
  create: (data: {
    title: string
    description?: string
    thumbnailUrl?: string
    visibility?: 'PUBLIC' | 'SUBSCRIBERS_ONLY' | 'PREMIUM_SUBSCRIBERS' | 'PRIVATE'
    isPpv?: boolean
    ppvPrice?: number
    scheduledFor?: string
  }) => api.post('/streaming', data),
  start: (streamId: string) => api.post(`/streaming/${streamId}/start`),
  end: (streamId: string) => api.post(`/streaming/${streamId}/end`),
  delete: (streamId: string) => api.delete(`/streaming/${streamId}`),
  join: (streamId: string) => api.post(`/streaming/${streamId}/join`),
  leave: (streamId: string) => api.post(`/streaming/${streamId}/leave`),
  // Tips go to the stream's creator through the payments endpoint
  sendTip: (creatorId: string, amount: number, message?: string) =>
    paymentsApi.sendTip(creatorId, amount, message),
}

export const storiesApi = {
  getFeed: () => api.get('/stories/feed'),
  getCreatorStories: (creatorId: string) => api.get(`/stories/creator/${creatorId}`),
  // Groups a creator's active stories into the shape the stories viewer expects
  getGroup: async (creatorId: string) => {
    const response = await api.get(`/stories/creator/${creatorId}`)
    const stories: any[] = Array.isArray(response.data) ? response.data : []
    const creator = stories[0]?.creator ?? { id: creatorId, username: '' }
    return {
      ...response,
      data: {
        userId: creatorId,
        user: creator,
        stories: stories
          .map((story) => ({
            ...story,
            user: story.creator,
            mediaType: story.type === 'VIDEO' ? 'VIDEO' : story.type === 'TEXT' ? 'TEXT' : 'IMAGE',
            views: story._count?.views ?? 0,
            likes: story._count?.likes ?? 0,
          }))
          .reverse(),
      },
    }
  },
  getStory: (storyId: string) => api.get(`/stories/${storyId}`),
  markAsViewed: (storyId: string) => api.post(`/stories/${storyId}/view`),
  getViewers: (storyId: string) => api.get(`/stories/${storyId}/viewers`),
  // Toggles the like; resolves to { liked, likesCount }
  like: (storyId: string) => api.post(`/stories/${storyId}/like`),
  // Delivered to the creator as a direct message
  reply: (storyId: string, message: string) =>
    api.post(`/stories/${storyId}/reply`, { message }),
  delete: (storyId: string) => api.delete(`/stories/${storyId}`),
}
