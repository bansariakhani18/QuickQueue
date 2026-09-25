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

function formatCreatedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

interface OrderCardProps {
  order: ActiveOrder
  onUnauthorized: () => void
}

export function OrderCard({ order, onUnauthorized }: OrderCardProps) {
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)

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
    },
    onError: handleMutationError,
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.setCancelled(order.id),
    onSuccess: () => {
      setActionError(null)
      refreshOrders()
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
    readyMutation.isPending || collectedMutation.isPending ||
    cancelMutation.isPending || recallMutation.isPending

  const attemptLabel = order.attemptNumber !== null ? `Attempt ${order.attemptNumber}` : null
  const notificationLabelValue = notificationLabel(order.notificationStatus)

  function renderNotification() {
    if (order.notificationStatus === null) {
      if (order.optOutActive) {
        return <span className="notice">Customer previously opted out — notify manually</span>
      }
      if (!order.consentGiven) {
        return <span className="notice">No WhatsApp consent — notify manually</span>
      }
      return <span className="notice">No notification yet</span>
    }
    const label = notificationLabelValue
    if (order.notificationStatus === 'FAILED') {
      return (
        <span className="notice notice-failed">
          {failedMessage()}
          {attemptLabel !== null ? ` (${attemptLabel})` : ''}
        </span>
      )
    }
    return (
      <span className={`notice notice-status`}>
        {label ?? order.notificationStatus}
        {attemptLabel !== null ? ` (${attemptLabel})` : null}
      </span>
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
      <div className="order-main">
        <div className="order-token" aria-label={`Display token ${order.displayToken}`}>
          {order.displayToken}
        </div>
        <div className="order-status-area">
          <span className={`status-label status-${order.status.toLowerCase()}`}>
            {order.status}
          </span>
          {renderNotification()}
        </div>
      </div>

      <div className="order-detail">
        {order.customerPhone !== null ? order.customerPhone : 'No phone'}
        {order.optOutActive ? ' · opted out' : ''}
      </div>

      <div className="order-detail">Created {formatCreatedAt(order.createdAt)}</div>

      <div className="order-actions">
        {order.status === 'PREPARING' && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={anyPending}
            onClick={() => readyMutation.mutate()}
          >
            {readyMutation.isPending ? 'Marking ready…' : 'Ready'}
          </button>
        )}

        {order.status === 'READY' && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={anyPending}
            onClick={() => collectedMutation.mutate()}
          >
            {collectedMutation.isPending ? 'Collecting…' : 'Collected'}
          </button>
        )}

        {(order.status === 'PREPARING' || order.status === 'READY') && (
          <button
            type="button"
            className="btn btn-cancel"
            disabled={anyPending}
            onClick={() => cancelMutation.mutate()}
          >
            {cancelMutation.isPending ? 'Cancelling…' : 'Cancel'}
          </button>
        )}

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