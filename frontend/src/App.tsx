import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from './api'
import { LoginScreen } from './components/LoginScreen'
import { ResetConfirmScreen, ResetRequestScreen } from './components/PasswordResetScreen'
import { SignupScreen } from './components/SignupScreen'
import { Dashboard } from './components/Dashboard'
import { Logo } from './components/Logo'
import { useSessionProbe, useCurrentUser } from './hooks/useOrders'
import type { RestaurantUser } from './types'

type AuthState = 'unknown' | 'yes' | 'no' | 'unreachable'

function readResetToken(): string | null {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  return token !== null && token.length > 0 ? token : null
}

export function App() {
  const queryClient = useQueryClient()
  const [authOverride, setAuthOverride] = useState<AuthState | null>(null)
  const [showResetRequest, setShowResetRequest] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [localUser, setLocalUser] = useState<RestaurantUser | null>(null)
  const [resetToken, setResetToken] = useState<string | null>(() => readResetToken())

  const onUnauthorized = useCallback(() => {
    setLocalUser(null)
    setAuthOverride('no')
  }, [])

  const sessionProbe = useSessionProbe()
  const currentUserQuery = useCurrentUser()

  // Prefer server-fetched user; fall back to locally-set user from login/signup
  const user = currentUserQuery.data ?? localUser

  // If currentUser 401s, force logout
  useEffect(() => {
    if (
      currentUserQuery.error instanceof ApiError &&
      currentUserQuery.error.status === 401 &&
      authOverride === 'yes'
    ) {
      setLocalUser(null)
      setAuthOverride('no')
    }
  }, [currentUserQuery.error, authOverride])

  if (resetToken !== null) {
    return (
      <ResetConfirmScreen
        token={resetToken}
        onDone={() => {
          if (typeof window !== 'undefined' && window.history?.replaceState) {
            const url = new URL(window.location.href)
            url.searchParams.delete('token')
            const search = url.searchParams.toString()
            const newUrl = url.pathname + (search ? `?${search}` : '') + url.hash
            window.history.replaceState({}, '', newUrl)
          }
          setResetToken(null)
          setLocalUser(null)
          setAuthOverride('no')
        }}
      />
    )
  }

  if (showResetRequest) {
    return <ResetRequestScreen onBackToLogin={() => setShowResetRequest(false)} />
  }

  if (showRegister) {
    return (
      <SignupScreen
        onSignedUp={(newUser) => {
          setLocalUser(newUser)
          setAuthOverride('yes')
          setShowRegister(false)
          queryClient.invalidateQueries({ queryKey: ['session'] })
          queryClient.invalidateQueries({ queryKey: ['current-user'] })
        }}
        onBackToLogin={() => setShowRegister(false)}
      />
    )
  }

  let authState: AuthState
  if (authOverride !== null) {
    authState = authOverride
  } else if (sessionProbe.isPending) {
    authState = 'unknown'
  } else if (sessionProbe.isSuccess) {
    authState = 'yes'
  } else if (sessionProbe.error instanceof ApiError && sessionProbe.error.status === 401) {
    authState = 'no'
  } else {
    authState = 'unreachable'
  }

  if (authState === 'unknown') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="state-note">Loading…</p>
        </div>
      </div>
    )
  }

  if (authState === 'no') {
    return (
      <LoginScreen
        onLogin={(loggedInUser) => {
          setLocalUser(loggedInUser)
          setAuthOverride('yes')
          queryClient.invalidateQueries({ queryKey: ['session'] })
          queryClient.invalidateQueries({ queryKey: ['current-user'] })
        }}
        onForgotPassword={() => setShowResetRequest(true)}
        onRegister={() => setShowRegister(true)}
      />
    )
  }

  if (authState === 'unreachable') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand-center">
            <Logo size={40} />
          </div>
          <p className="alert alert-error" role="alert">
            Could not reach the server. Make sure the backend is running, then try again.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => sessionProbe.refetch()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <Dashboard
      user={user}
      onLogout={() => {
        setLocalUser(null)
        setAuthOverride('no')
        queryClient.removeQueries({ queryKey: ['current-user'] })
      }}
      onUnauthorized={onUnauthorized}
    />
  )
}
