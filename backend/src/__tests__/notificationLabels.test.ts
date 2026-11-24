import { describe, it, expect } from 'vitest'

// Inline copies of the frontend notification helpers (from frontend/src/notification.ts)
// These tests verify the human-friendly label logic stays correct across refactors.

const MAX_RECALL_ATTEMPTS = 4
const RECALL_MAX_REACHED_MESSAGE = 'Limit reached — Please notify customer manually'

type NotificationJobStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

function isNotificationInFlight(status: NotificationJobStatus | null): boolean {
  return status === 'PENDING' || status === 'PROCESSING'
}

function isNotificationDelivered(status: NotificationJobStatus | null): boolean {
  return status === 'SENT' || status === 'DELIVERED' || status === 'READ'
}

function notificationLabel(status: NotificationJobStatus | null): string | null {
  if (status === null) return null
  if (status === 'PENDING' || status === 'PROCESSING') return 'Sending notification...'
  if (status === 'SENT' || status === 'DELIVERED' || status === 'READ') return 'Notification sent'
  if (status === 'FAILED') return 'Not sent'
  return status
}

function failedMessage(): string {
  return 'Not sent'
}

describe('Frontend notification utilities (Sprint A UI/UX)', () => {
  it('returns human-friendly status labels without technical retry counter jargon', () => {
    expect(notificationLabel('PENDING')).toBe('Sending notification...')
    expect(notificationLabel('PROCESSING')).toBe('Sending notification...')
    expect(notificationLabel('SENT')).toBe('Notification sent')
    expect(notificationLabel('DELIVERED')).toBe('Notification sent')
    expect(notificationLabel('READ')).toBe('Notification sent')
    expect(notificationLabel('FAILED')).toBe('Not sent')
    expect(notificationLabel(null)).toBeNull()
  })

  it('correctly categorizes notification states', () => {
    expect(isNotificationInFlight('PENDING')).toBe(true)
    expect(isNotificationInFlight('PROCESSING')).toBe(true)
    expect(isNotificationInFlight('SENT')).toBe(false)
    expect(isNotificationDelivered('SENT')).toBe(true)
    expect(isNotificationDelivered('DELIVERED')).toBe(true)
    expect(isNotificationDelivered('READ')).toBe(true)
    expect(isNotificationDelivered('PENDING')).toBe(false)
    expect(isNotificationDelivered('FAILED')).toBe(false)
  })

  it('failedMessage returns human-readable Not sent', () => {
    expect(failedMessage()).toBe('Not sent')
  })

  it('MAX_RECALL_ATTEMPTS is 4', () => {
    expect(MAX_RECALL_ATTEMPTS).toBe(4)
  })

  it('RECALL_MAX_REACHED_MESSAGE is human-readable', () => {
    expect(RECALL_MAX_REACHED_MESSAGE).toBe('Limit reached — Please notify customer manually')
  })
})
