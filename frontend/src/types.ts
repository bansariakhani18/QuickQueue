export type OrderStatus = 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED'

export type NotificationJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'

export interface RestaurantUser {
  id: string
  name: string
  email: string
}

export interface ActiveOrder {
  id: string
  displayToken: string
  customerPhone: string | null
  consentGiven: boolean
  status: OrderStatus
  createdAt: string
  notificationStatus: NotificationJobStatus | null
  attemptNumber: number | null
  optOutActive: boolean
}

export interface CreateOrderInput {
  displayToken: string
  customerPhone: string
  consentGiven: boolean
}

export type ConnectionStatus =
  | 'NOT_CONNECTED'
  | 'PENDING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'

export interface ConnectionStatusInfo {
  connectionStatus: ConnectionStatus
  connectedAt: string | null
}

export interface OrderStatusResponse {
  id: string
  displayToken: string
  status: OrderStatus
  readyAt: string | null
  collectedAt: string | null
  cancelledAt: string | null
  terminalAt: string | null
}