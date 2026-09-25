import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, ApiError } from '../api'
import type { ConnectionStatus } from '../types'

const CONNECTION_POLL_MS = 30_000

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  NOT_CONNECTED: 'Not connected',
  PENDING: 'Waiting for WhatsApp authorization',
  CONNECTED: 'Connected',
  DISCONNECTED: 'Disconnected',
  ERROR: 'Error',
}

const HONEST_PENDING_NOTE =
  'QuickQueue is ready to receive your WhatsApp connection. Meta’s Embedded Signup popup is not available in this development environment, so the status stays here until the backend records a real Meta connection.'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface WhatsAppConnectionPanelProps {
  onUnauthorized: () => void
}

export function WhatsAppConnectionPanel({ onUnauthorized }: WhatsAppConnectionPanelProps) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: ['connection-status'],
    queryFn: () => api.getConnectionStatus(),
    refetchInterval: CONNECTION_POLL_MS,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false
      return failureCount < 2
    },
  })

  useEffect(() => {
    if (statusQuery.error instanceof ApiError && statusQuery.error.status === 401) {
      onUnauthorized()
    }
  }, [statusQuery.error, onUnauthorized])

  const connectMutation = useMutation({
    mutationFn: () => api.initiateConnection(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connection-status'] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized()
      }
    },
  })

  const status = statusQuery.data?.connectionStatus ?? 'NOT_CONNECTED'
  const connectedAt = statusQuery.data?.connectedAt ?? null
  const showConnectButton = status === 'NOT_CONNECTED' || status === 'DISCONNECTED' || status === 'ERROR'

  return (
    <section className="connection-panel" aria-label="WhatsApp connection">
      <div className="connection-head">
        <div className="connection-info">
          <span className="connection-icon" aria-hidden="true">💬</span>
          <h2 className="connection-title">WhatsApp Integration</h2>
          <span className={`connection-status connection-${status.toLowerCase()}`}>
            {STATUS_LABELS[status]}
          </span>
        </div>

        {showConnectButton && (
          <button
            type="button"
            className="btn btn-connect"
            disabled={connectMutation.isPending}
            onClick={() => connectMutation.mutate()}
          >
            {connectMutation.isPending ? 'Starting…' : status === 'ERROR' ? 'Retry connection' : 'Connect WhatsApp'}
          </button>
        )}
      </div>

      {status === 'CONNECTED' && connectedAt !== null && (
        <p className="connection-note">Connected since {formatDate(connectedAt)}.</p>
      )}

      {status === 'PENDING' && (
        <details className="connection-details">
          <summary className="connection-summary-toggle">
            Waiting for Meta authorization · View dev setup note
          </summary>
          <p className="connection-note">{HONEST_PENDING_NOTE}</p>
        </details>
      )}
    </section>
  )
}