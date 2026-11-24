import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError } from '../api'
import {
  failedMessage,
  isNotificationDelivered,
  isNotificationInFlight,
  MAX_RECALL_ATTEMPTS,
  notificationLabel,
  RECALL_MAX_REACHED_MESSAGE,
} from '../notification'
import type { ActiveOrder } from '../types'

export function formatElapsedTime(iso: string, now: number): string {
  const date = new Date(iso)
  const diffMs = now - date.getTime()
  if (Number.isNaN(diffMs) || diffMs < 0) return 'Just now'
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'Just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  const remMin = diffMin % 60
  if (remMin === 0) return `${diffHours}h ago`
  return `${diffHours}h ${remMin}m ago`
}

export function formatTimeOnly(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// Inline SVG icon components (16px, monochrome stroke)
function IconBan() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  )
}

function IconAlertTriangle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function IconHourglass() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 007 17.828V22M7 2v4.172a2 2 0 00.586 1.414L12 12l4.414-4.414A2 2 0 0017 6.172V2" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.01 1.17 2 2 0 012 .01h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  )
}

interface OrderCardProps {
  order: ActiveOrder
  isDuplicateToken?: boolean
  now?: number
  onActionSuccess?: (message: string) => void
  onUnauthorized: () => void
}

export function OrderCard({
  order,
  isDuplicateToken = false,
  now,
  onActionSuccess,
  onUnauthorized,
}: OrderCardProps) {
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const currentTime = now ?? Date.now()

  function refreshOrders() {
    queryClient.invalidateQueries({ queryKey: ['orders'] })
  }

  function handleMutationError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        onUnauthorized()
        return
      }
      if (err.status === 0) {
        refreshOrders()
        setActionError('Could not confirm the action — showing the latest order state.')
        return
      }
      setActionError(err.message)
      return
    }
    setActionError('Something went wrong. Please try again.')
  }

  const readyMutation = useMutation({
    mutationFn: () => api.setReady(order.id),
    onSuccess: () => {
      setActionError(null)
      refreshOrders()
    },
    onError: handleMutationError,
  })

  const collectedMutation = useMutation({
    mutationFn: () => api.setCollected(order.id),
    onSuccess: () => {
      setActionError(null)
      refreshOrders()
      onActionSuccess?.(`Order ${order.displayToken} marked collected`)
    },
    onError: handleMutationError,
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.setCancelled(order.id),
    onSuccess: () => {
      setActionError(null)
      refreshOrders()
      onActionSuccess?.(`Order ${order.displayToken} cancelled`)
    },
    onError: handleMutationError,
  })

  const recallMutation = useMutation({
    mutationFn: () => api.recall(order.id),
    onSuccess: () => {
      setActionError(null)
      refreshOrders()
    },
    onError: handleMutationError,
  })

  const anyPending =
    readyMutation.isPending ||
    collectedMutation.isPending ||
    cancelMutation.isPending ||
    recallMutation.isPending

  const inFlight = isNotificationInFlight(order.notificationStatus)
  const delivered = isNotificationDelivered(order.notificationStatus)
  const isFailed = order.notificationStatus === 'FAILED'
  const isMaxAttempts = order.attemptNumber !== null && order.attemptNumber >= MAX_RECALL_ATTEMPTS

  function renderNotification() {
    if (order.notificationStatus === null) {
      if (order.optOutActive) {
        return (
          <div className="notif-badge notif-optout">
            <span className="notif-icon" aria-hidden="true"><IconBan /></span>
            <span className="notif-text">Customer previously opted out — notify manually</span>
          </div>
        )
      }
      if (!order.consentGiven) {
        return (
          <div className="notif-badge notif-noconsent">
            <span className="notif-icon" aria-hidden="true"><IconAlertTriangle /></span>
            <span className="notif-text">No WhatsApp consent — notify manually</span>
          </div>
        )
      }
      return (
        <div className="notif-badge notif-none">
          <span className="notif-icon" aria-hidden="true"><IconHourglass /></span>
          <span className="notif-text">No notification yet</span>
        </div>
      )
    }

    if (inFlight) {
      return (
        <div className="notif-badge notif-sending">
          <span className="pulse-dot" aria-hidden="true"></span>
          <span className="notif-text">Sending notification...</span>
        </div>
      )
    }

    if (delivered) {
      return (
        <div className="notif-badge notif-delivered">
          <span className="notif-check" aria-hidden="true"><IconCheck /></span>
          <span className="notif-text">Notification sent</span>
        </div>
      )
    }

    if (isFailed) {
      return (
        <div className="notif-badge notif-failed" role="alert">
          <span className="notif-icon" aria-hidden="true"><IconX /></span>
          <span className="notif-text">{failedMessage()}</span>
        </div>
      )
    }

    return (
      <div className={`notif-badge notif-${order.notificationStatus.toLowerCase()}`}>
        <span className="notif-text">{notificationLabel(order.notificationStatus)}</span>
      </div>
    )
  }

  let recallDisabled = false
  let recallReason: string | null = null
  if (order.status === 'READY') {
    if (inFlight) {
      recallDisabled = true
      recallReason = 'Notification in progress'
    } else if (isMaxAttempts) {
      recallDisabled = true
      recallReason = RECALL_MAX_REACHED_MESSAGE
    }
  }

  return (
    <article className={`order order-${order.status.toLowerCase()}`}>
      <div className="order-header">
        <div className="order-token-group">
          <div className="order-token-meta">
            <span className="order-token-label">TOKEN</span>
            {isDuplicateToken && (
              <span className="badge badge-duplicate" title="Multiple active orders have this display token">
                Duplicate token
              </span>
            )}
          </div>
          <div className="order-token" aria-label={`Display token ${order.displayToken}`}>
            {order.displayToken}
          </div>
        </div>
        <div className="order-status-area">
          <span className={`status-badge status-${order.status.toLowerCase()}`}>
            {order.status}
          </span>
        </div>
      </div>

      <div className="order-notification-row">
        {renderNotification()}
      </div>

      {isMaxAttempts && (
        <div className="limit-reached-banner" role="alert">
          <span className="limit-icon" aria-hidden="true"><IconAlertTriangle /></span>
          <span>Limit reached — Please notify customer manually</span>
        </div>
      )}

      <div className="order-meta">
        <div className="order-meta-item order-time">
          <span className="meta-icon" aria-hidden="true"><IconClock /></span>
          <span className="time-elapsed">Waiting {formatElapsedTime(order.createdAt, currentTime)}</span>
          <span className="time-exact">({formatTimeOnly(order.createdAt)})</span>
        </div>

        <div className="order-meta-item order-phone">
          <span className="meta-icon" aria-hidden="true"><IconPhone /></span>
          <span className="phone-number">{order.customerPhone !== null ? order.customerPhone : 'No phone'}</span>
          {order.optOutActive && <span className="opt-out-badge">Opted out</span>}
        </div>
      </div>

      <div className="order-actions">
        {order.status === 'PREPARING' && (
          <button
            type="button"
            className="btn btn-ready"
            disabled={anyPending}
            onClick={() => readyMutation.mutate()}
          >
            {readyMutation.isPending ? 'Marking ready…' : 'Mark Ready'}
          </button>
        )}

        {order.status === 'READY' && (
          <button
            type="button"
            className="btn btn-collect"
            disabled={anyPending}
            onClick={() => collectedMutation.mutate()}
          >
            {collectedMutation.isPending ? 'Collecting…' : 'Mark Collected'}
          </button>
        )}

        <button
          type="button"
          className="btn btn-cancel"
          disabled={anyPending}
          onClick={() => cancelMutation.mutate()}
        >
          {cancelMutation.isPending ? 'Cancelling…' : 'Cancel'}
        </button>

        {order.status === 'READY' && (
          <div className="recall-area">
            {!isMaxAttempts && (
              <button
                type="button"
                className={`btn ${isFailed ? 'btn-try-again' : 'btn-recall'}`}
                disabled={recallDisabled || anyPending}
                onClick={() => recallMutation.mutate()}
              >
                {recallMutation.isPending
                  ? 'Sending…'
                  : isFailed
                  ? 'Try again'
                  : 'Remind again'}
              </button>
            )}
            {recallDisabled && !isMaxAttempts && recallReason !== null && (
              <p className="recall-reason">{recallReason}</p>
            )}
          </div>
        )}
      </div>

      {actionError !== null && <p className="alert alert-error" role="alert">{actionError}</p>}
    </article>
  )
}
