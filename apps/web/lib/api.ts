import axios, { AxiosError } from 'axios'

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

// Response interceptor - Handle errors and token refresh
api.interceptors.response.use(
  (response) => response,
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
  login: (data: { email: string; password: string; totpCode?: string }) =>
    api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  enable2FA: () => api.post('/auth/2fa/enable'),
  verify2FA: (code: string) => api.post('/auth/2fa/verify', { code }),
  disable2FA: (code: string) => api.post('/auth/2fa/disable', { code }),
}

export const usersApi = {
  getMe: () => api.get('/users/me'),
  getProfile: () => api.get('/users/me'),
  getByUsername: (username: string) => api.get(`/users/${username}`),
  updateProfile: (data: any) => api.put('/users/profile', data),
  getStats: () => api.get('/users/stats'),
}

export const mediaApi = {
  upload: (formData: FormData, config?: any) =>
    api.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      ...config,
    }),
  uploadImage: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
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
  create: (data: {
    title: string
    description?: string
    tier: string
    type: string
    mediaIds?: string[]
    fileIds?: string[]
    isPPV?: boolean
    ppvPrice?: number
  }) => api.post('/content', data),
  update: (id: string, data: any) => api.put(`/content/${id}`, data),
  delete: (id: string) => api.delete(`/content/${id}`),
  likeContent: (id: string) => api.post(`/content/${id}/like`),
  unlockPPV: (id: string) => api.post(`/content/${id}/unlock`),
}

export const messagesApi = {
  getConversations: () => api.get('/messages/conversations'),
  getMessages: (partnerId: string) => api.get(`/messages/${partnerId}`),
}

export const notificationsApi = {
  getAll: (unreadOnly: boolean = false) =>
    api.get(`/notifications?unreadOnly=${unreadOnly}`),
  markAsRead: (id: string) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/read-all'),
  deleteNotification: (id: string) => api.delete(`/notifications/${id}`),
}

export const socialApi = {
  // Comments
  getComments: (contentId: string, page: number = 1, limit: number = 20) =>
    api.get(`/social/comments/${contentId}?page=${page}&limit=${limit}`),
  createComment: (contentId: string, text: string) =>
    api.post('/social/comments', { contentId, text }),
  updateComment: (commentId: string, text: string) =>
    api.put(`/social/comments/${commentId}`, { text }),
  deleteComment: (commentId: string) =>
    api.delete(`/social/comments/${commentId}`),

  // Follow/Unfollow
  followCreator: (creatorId: string) =>
    api.post(`/social/follow/${creatorId}`),
  unfollowCreator: (creatorId: string) =>
    api.delete(`/social/follow/${creatorId}`),
  getFollowing: () =>
    api.get('/social/following'),

  // Discover
  discoverCreators: (params?: {
    search?: string
    page?: number
    limit?: number
    sort?: string
  }) => api.get('/social/discover', { params }),

  // Search
  searchCreators: (query: string) =>
    api.get(`/social/search?q=${encodeURIComponent(query)}`),
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
