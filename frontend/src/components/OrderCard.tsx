import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError } from '../api'
import {
  failedMessage,
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

  const attemptLabel = order.attemptNumber !== null ? `Attempt ${order.attemptNumber}` : null
  const notificationLabelValue = notificationLabel(order.notificationStatus)

  function renderNotification() {
    if (order.notificationStatus === null) {
      if (order.optOutActive) {
        return (
          <div className="notif-badge notif-optout">
            <span className="notif-prefix">Notification:</span>
            <span className="notif-text">Customer previously opted out — notify manually</span>
          </div>
        )
      }
      if (!order.consentGiven) {
        return (
          <div className="notif-badge notif-noconsent">
            <span className="notif-prefix">Notification:</span>
            <span className="notif-text">No WhatsApp consent — notify manually</span>
          </div>
        )
      }
      return (
        <div className="notif-badge notif-none">
          <span className="notif-prefix">Notification:</span>
          <span className="notif-text">No notification yet</span>
        </div>
      )
    }

    if (order.notificationStatus === 'FAILED') {
      return (
        <div className="notif-badge notif-failed" role="alert">
          <span className="notif-prefix">Notification:</span>
          <span className="notif-text">{failedMessage()}</span>
          {attemptLabel !== null && <span className="notif-attempt">{attemptLabel}</span>}
        </div>
      )
    }

    return (
      <div className={`notif-badge notif-${order.notificationStatus.toLowerCase()}`}>
        <span className="notif-prefix">Notification:</span>
        <span className="notif-text">{notificationLabelValue ?? order.notificationStatus}</span>
        {attemptLabel !== null && <span className="notif-attempt">{attemptLabel}</span>}
      </div>
    )
  }

  let recallDisabled = false
  let recallReason: string | null = null
  if (order.status === 'READY') {
    if (isNotificationInFlight(order.notificationStatus)) {
      recallDisabled = true
      recallReason = 'Notification in progress'
    } else if (order.attemptNumber !== null && order.attemptNumber >= MAX_RECALL_ATTEMPTS) {
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
          <span className={`status-label status-${order.status.toLowerCase()}`}>
            {order.status}
          </span>
        </div>
      </div>

      <div className="order-notification-row">
        {renderNotification()}
      </div>

      <div className="order-meta">
        <div className="order-meta-item order-time">
          <span className="meta-icon" aria-hidden="true">⏱</span>
          <span className="time-elapsed">Waiting {formatElapsedTime(order.createdAt, currentTime)}</span>
          <span className="time-exact">({formatTimeOnly(order.createdAt)})</span>
        </div>

        <div className="order-meta-item order-phone">
          <span className="meta-icon" aria-hidden="true">📞</span>
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
            <button
              type="button"
              className="btn btn-recall"
              disabled={recallDisabled || anyPending}
              onClick={() => recallMutation.mutate()}
            >
              {recallMutation.isPending ? 'Resending…' : 'Resend (RECALL)'}
            </button>
            {recallDisabled && recallReason !== null && (
              <p className="recall-reason">{recallReason}</p>
            )}
          </div>
        )}
      </div>

      {actionError !== null && <p className="alert alert-error" role="alert">{actionError}</p>}
    </article>
  )
}