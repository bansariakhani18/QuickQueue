import type {
  ActiveOrder,
  ConnectionStatusInfo,
  CreateOrderInput,
  OrderStatusResponse,
  RestaurantUser,
} from './types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (typeof body.error === 'string' && body.error.length > 0) {
        message = body.error
      }
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(response.status, message)
  }

  return (await response.json()) as T
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? '{}' : JSON.stringify(body),
  })
}

export const api = {
  login(email: string, password: string): Promise<RestaurantUser> {
    return post<RestaurantUser>('/auth/login', { email, password })
  },

  signup(name: string, email: string, password: string): Promise<RestaurantUser> {
    return post<RestaurantUser>('/auth/signup', { name, email, password })
  },

  logout(): Promise<{ message: string }> {
    return post<{ message: string }>('/auth/logout')
  },

  getConnectionStatus(): Promise<ConnectionStatusInfo> {
    return request<ConnectionStatusInfo>('/connections/status')
  },

  initiateConnection(): Promise<{ connectionStatus: string }> {
    return post<{ connectionStatus: string }>('/connections/signup/initiate')
  },

  requestPasswordReset(email: string): Promise<{ message: string }> {
    return post<{ message: string }>('/auth/password-reset/request', { email })
  },

  confirmPasswordReset(token: string, newPassword: string): Promise<{ message: string }> {
    return post<{ message: string }>('/auth/password-reset/confirm', { token, newPassword })
  },

  createOrder(input: CreateOrderInput): Promise<ActiveOrder> {
    return post<ActiveOrder>('/orders', input)
  },

  listOrders(search = ''): Promise<{ orders: ActiveOrder[] }> {
    const query = search.trim() === '' ? '' : `?search=${encodeURIComponent(search.trim())}`
    return request<{ orders: ActiveOrder[] }>(`/orders${query}`)
  },

  setReady(orderId: string): Promise<OrderStatusResponse> {
    return post<OrderStatusResponse>(`/orders/${orderId}/ready`)
  },

  setCollected(orderId: string): Promise<OrderStatusResponse> {
    return post<OrderStatusResponse>(`/orders/${orderId}/collected`)
  },

  setCancelled(orderId: string): Promise<OrderStatusResponse> {
    return post<OrderStatusResponse>(`/orders/${orderId}/cancel`)
  },

  recall(orderId: string): Promise<{ message: string; attemptNumber: number }> {
    return post<{ message: string; attemptNumber: number }>(`/orders/${orderId}/recall`)
  },
}