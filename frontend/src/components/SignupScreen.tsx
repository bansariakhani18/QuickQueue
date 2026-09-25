import { useState } from 'react'
import { api, ApiError } from '../api'
import type { RestaurantUser } from '../types'

interface SignupScreenProps {
  onSignedUp: (user: RestaurantUser) => void
  onBackToLogin: () => void
}

export function SignupScreen({ onSignedUp, onBackToLogin }: SignupScreenProps) {
  const [name, setName] = useState('')
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
      const user = await api.signup(name.trim(), email.trim(), password)
      onSignedUp(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="brand">QuickQueue</h1>
        <p className="auth-intro">Create a restaurant account</p>

        {error !== null && <p className="alert alert-error" role="alert">{error}</p>}

        <label htmlFor="signup-name">Restaurant name</label>
        <input
          id="signup-name"
          type="text"
          autoComplete="organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <button type="button" className="btn btn-link" onClick={onBackToLogin}>
          Back to sign in
        </button>
      </form>
    </div>
  )
}