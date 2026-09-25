import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import { OrderCreateForm } from './OrderCreateForm'
import { OrderCard } from './OrderCard'
import { WhatsAppConnectionPanel } from './WhatsAppConnectionPanel'
import { useOrders } from '../hooks/useOrders'
import type { RestaurantUser } from '../types'

interface DashboardProps {
  user: RestaurantUser | null
  onLogout: () => void
  onUnauthorized: () => void
}

export function Dashboard({ user, onLogout, onUnauthorized }: DashboardProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const queryClient = useQueryClient()

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 3500)
    return () => clearTimeout(timer)
  }, [toastMessage])

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
  }, [])

  const ordersQuery = useOrders(debouncedSearch)

  useEffect(() => {
    if (ordersQuery.error instanceof ApiError && ordersQuery.error.status === 401) {
      onUnauthorized()
    }
  }, [ordersQuery.error, onUnauthorized])

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      queryClient.clear()
      onLogout()
    },
    onError: () => {
      queryClient.clear()
      onLogout()
    },
  })

  const orders = ordersQuery.data?.orders ?? []
  const readyCount = orders.filter((o) => o.status === 'READY').length
  const preparingCount = orders.filter((o) => o.status === 'PREPARING').length

  const tokenCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of orders) {
      const key = o.displayToken.trim().toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [orders])

  const activeTokens = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders) {
      set.add(o.displayToken.trim().toLowerCase())
    }
    return set
  }, [orders])

  const isFiltering = debouncedSearch.trim().length > 0

  return (
    <div className="dashboard">
      <header className="app-header">
        <h1 className="brand app-brand">QuickQueue</h1>
        <div className="app-header-right">
          {user !== null && <span className="restaurant-name">{user.name}</span>}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>

      {toastMessage !== null && (
        <div className="action-toast" role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden="true">✓</span>
          <span className="toast-text">{toastMessage}</span>
        </div>
      )}

      <main className="app-main">
        <WhatsAppConnectionPanel onUnauthorized={onUnauthorized} />

        <OrderCreateForm
          activeTokens={activeTokens}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['orders'] })}
          onUnauthorized={onUnauthorized}
        />

        <section className="orders-section" aria-label="Active orders">
          <div className="orders-toolbar">
            <div className="orders-title-group">
              <h2 className="orders-heading">Active orders</h2>
              {!ordersQuery.isPending && (
                <span className="orders-summary-pill">
                  {orders.length} active · {readyCount} ready · {preparingCount} preparing
                </span>
              )}
            </div>

            <div className="search-wrapper">
              <input
                type="search"
                className="search-input"
                placeholder="Search by token or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search orders by token or phone"
              />
              {search.length > 0 && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearch('')}
                  aria-label="Clear search filter"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {isFiltering && (
            <div className="search-filter-banner">
              <span>
                Showing {orders.length} matching order{orders.length === 1 ? '' : 's'} for &ldquo;{debouncedSearch.trim()}&rdquo;
              </span>
              <button
                type="button"
                className="btn-link btn-clear-filter"
                onClick={() => setSearch('')}
              >
                Clear search
              </button>
            </div>
          )}

          {ordersQuery.isPending && ordersQuery.isFetching && (
            <p className="state-note">Loading orders…</p>
          )}

          {ordersQuery.error !== null && ordersQuery.error instanceof ApiError &&
            ordersQuery.error.status !== 401 && (
              <div className="state-note state-error">
                <p>{ordersQuery.error.message}</p>
                <button type="button" className="btn" onClick={() => ordersQuery.refetch()}>
                  Retry
                </button>
              </div>
            )}

          {!ordersQuery.isPending && ordersQuery.data !== undefined && orders.length === 0 && (
            <div className="empty-state-box">
              {isFiltering ? (
                <p className="state-note">
                  No matching orders found for &ldquo;{debouncedSearch.trim()}&rdquo;.
                </p>
              ) : (
                <p className="state-note">No active orders right now.</p>
              )}
            </div>
          )}

          {orders.length > 0 && (
            <div className="orders-list">
              {orders.map((order) => {
                const key = order.displayToken.trim().toLowerCase()
                const isDuplicate = (tokenCounts.get(key) ?? 0) > 1
                return (
                  <OrderCard
                    key={order.id}
                    order={order}
                    isDuplicateToken={isDuplicate}
                    now={now}
                    onActionSuccess={showToast}
                    onUnauthorized={onUnauthorized}
                  />
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}