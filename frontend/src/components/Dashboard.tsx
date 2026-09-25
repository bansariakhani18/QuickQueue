import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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
  const queryClient = useQueryClient()

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timeout)
  }, [search])

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

      <main className="app-main">
        <WhatsAppConnectionPanel onUnauthorized={onUnauthorized} />

        <OrderCreateForm
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['orders'] })}
          onUnauthorized={onUnauthorized}
        />

        <section className="orders-section" aria-label="Active orders">
          <div className="orders-toolbar">
            <h2>Active orders</h2>
            <input
              type="search"
              placeholder="Search by token or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

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

          {!ordersQuery.isPending && ordersQuery.data !== undefined &&
            ordersQuery.data.orders.length === 0 && (
              <p className="state-note">No active orders right now.</p>
            )}

          {ordersQuery.data !== undefined && ordersQuery.data.orders.length > 0 && (
            <div className="orders-list">
              {ordersQuery.data.orders.map((order) => (
                <OrderCard key={order.id} order={order} onUnauthorized={onUnauthorized} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}