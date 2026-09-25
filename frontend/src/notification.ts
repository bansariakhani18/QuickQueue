import type { NotificationJobStatus } from './types'

const STATUS_LABELS: Record<NotificationJobStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Sending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
}

export const MAX_RECALL_ATTEMPTS = 4
export const RECALL_MAX_REACHED_MESSAGE =
  'Maximum resend attempts reached — please notify the customer manually'

export function notificationLabel(status: NotificationJobStatus | null): string | null {
  if (status === null) return null
  return STATUS_LABELS[status] ?? null
}

export function isNotificationInFlight(status: NotificationJobStatus | null): boolean {
  return status === 'PENDING' || status === 'PROCESSING'
}

export function failedMessage(): string {
  return 'Failed — notify the customer manually'
}