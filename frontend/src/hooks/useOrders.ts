import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export const POLL_INTERVAL_MS = 5000

export function useOrders(search: string) {
  return useQuery({
    queryKey: ['orders', search],
    queryFn: () => api.listOrders(search),
    refetchInterval: POLL_INTERVAL_MS,
    retry: (failureCount, error) => {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 401) {
        return false
      }
      return failureCount < 2
    },
  })
}

export function useSessionProbe() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.listOrders(''),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 401) {
        return false
      }
      return failureCount < 2
    },
  })
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: () => api.getMe(),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 401) {
        return false
      }
      return failureCount < 2
    },
  })
}
