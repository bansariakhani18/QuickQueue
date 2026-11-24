import { useState } from 'react'
import { api, ApiError } from '../api'
import { Logo } from './Logo'
import type { RestaurantUser } from '../types'

interface LoginScreenProps {
  onLogin: (user: RestaurantUser) => void
  onForgotPassword: () => void
  onRegister: () => void
}

export function LoginScreen({ onLogin, onForgotPassword, onRegister }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const user = await api.login(email.trim(), password)
      onLogin(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand-center">
          <Logo size={40} />
        </div>
        <p className="auth-intro">Staff sign-in</p>

        {error !== null && <p className="alert alert-error" role="alert">{error}</p>}

        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <button type="button" className="btn btn-link" onClick={onForgotPassword}>
          Forgot password?
        </button>

        <button type="button" className="btn btn-link" onClick={onRegister}>
          Create an account
        </button>
      </form>
    </div>
  )
}