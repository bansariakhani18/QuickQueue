import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import { OrderCreateForm } from './OrderCreateForm'
import { OrderCard } from './OrderCard'
import { SettingsView } from './SettingsView'
import { Logo } from './Logo'
import { useOrders } from '../hooks/useOrders'
import type { RestaurantUser, ActiveOrder } from '../types'

interface DashboardProps {
  user: RestaurantUser | null
  onLogout: () => void
  onUnauthorized: () => void
}

type DashboardTab = 'orders' | 'settings'

function normalizeSearchDigits(val: string): string {
  return val.replace(/\D/g, '')
}

export function Dashboard({ user, onLogout, onUnauthorized }: DashboardProps) {
  const [currentTab, setCurrentTab] = useState<DashboardTab>('orders')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const queryClient = useQueryClient()

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 250)
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

  const rawOrders: ActiveOrder[] = ordersQuery.data?.orders ?? []

  // Client-side tolerant phone number & token filtering guarantee
  const filteredOrders = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return rawOrders

    const searchDigits = normalizeSearchDigits(q)

    return rawOrders.filter((order) => {
      const tokenMatch = order.displayToken.toLowerCase().includes(q)
      if (tokenMatch) return true

      if (order.customerPhone) {
        const phoneRawMatch = order.customerPhone.toLowerCase().includes(q)
        if (phoneRawMatch) return true

        if (searchDigits.length > 0) {
          const orderDigits = normalizeSearchDigits(order.customerPhone)
          if (orderDigits.includes(searchDigits)) return true
        }
      }

      return false
    })
  }, [rawOrders, debouncedSearch])

  const readyCount = rawOrders.filter((o) => o.status === 'READY').length
  const preparingCount = rawOrders.filter((o) => o.status === 'PREPARING').length

  const tokenCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of rawOrders) {
      const key = o.displayToken.trim().toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [rawOrders])

  const activeTokens = useMemo(() => {
    const set = new Set<string>()
    for (const o of rawOrders) {
      set.add(o.displayToken.trim().toLowerCase())
    }
    return set
  }, [rawOrders])

  const isFiltering = debouncedSearch.trim().length > 0

  return (
    <div className="dashboard">
      <header className="app-header">
        <div className="app-header-left">
          <Logo size={32} />
          <nav className="header-nav" aria-label="Main Navigation">
            <button
              type="button"
              className={`nav-tab ${currentTab === 'orders' ? 'nav-tab-active' : ''}`}
              onClick={() => setCurrentTab('orders')}
            >
              Orders
              {readyCount > 0 && <span className="tab-pill">{readyCount}</span>}
            </button>
            <button
              type="button"
              className={`nav-tab ${currentTab === 'settings' ? 'nav-tab-active' : ''}`}
              onClick={() => setCurrentTab('settings')}
            >
              Settings & Profile
            </button>
          </nav>
        </div>

        <div className="app-header-right">
          {user !== null && (
            <div className="user-profile-badge" title={user.email}>
              <span className="user-avatar-initial">{user.name.charAt(0).toUpperCase()}</span>
              <span className="restaurant-name">{user.name}</span>
            </div>
          )}
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
          <span className="toast-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="toast-text">{toastMessage}</span>
        </div>
      )}

      <main className="app-main">
        {currentTab === 'settings' ? (
          <SettingsView user={user} onUnauthorized={onUnauthorized} />
        ) : (
          <>
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
                      {rawOrders.length} active · {readyCount} ready · {preparingCount} preparing
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {isFiltering && (
                <div className="search-filter-banner">
                  <span>
                    Showing {filteredOrders.length} matching order{filteredOrders.length === 1 ? '' : 's'} for &ldquo;{debouncedSearch.trim()}&rdquo;
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

              {!ordersQuery.isPending && filteredOrders.length === 0 && (
                <div className="empty-orders-state">
                  <p className="empty-title">
                    {isFiltering ? 'No matching orders found' : 'No active orders in the queue'}
                  </p>
                  <p className="empty-sub">
                    {isFiltering
                      ? 'Try searching by a different token or phone number.'
                      : 'New orders entered above will show up here in real time.'}
                  </p>
                </div>
              )}

              {filteredOrders.length > 0 && (
                <div className="orders-grid">
                  {filteredOrders.map((order) => {
                    const isDuplicate =
                      (tokenCounts.get(order.displayToken.trim().toLowerCase()) ?? 0) > 1
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
          </>
        )}
      </main>
    </div>
  )
}
