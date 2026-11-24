import type { NotificationJobStatus } from './types'

export const MAX_RECALL_ATTEMPTS = 4
export const RECALL_MAX_REACHED_MESSAGE =
  'Limit reached — Please notify customer manually'

export function isNotificationInFlight(status: NotificationJobStatus | null): boolean {
  return status === 'PENDING' || status === 'PROCESSING'
}

export function isNotificationDelivered(status: NotificationJobStatus | null): boolean {
  return status === 'SENT' || status === 'DELIVERED' || status === 'READ'
}

export function notificationLabel(status: NotificationJobStatus | null): string | null {
  if (status === null) return null
  if (status === 'PENDING' || status === 'PROCESSING') return 'Sending notification...'
  if (status === 'SENT' || status === 'DELIVERED' || status === 'READ') return 'Notification sent'
  if (status === 'FAILED') return 'Not sent'
  return status
}

export function failedMessage(): string {
  return 'Not sent'
}
