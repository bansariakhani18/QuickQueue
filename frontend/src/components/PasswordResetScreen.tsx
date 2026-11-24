import { useState } from 'react'
import { api, ApiError } from '../api'
import { Logo } from './Logo'

interface ResetRequestScreenProps {
  onBackToLogin: () => void
}

export function ResetRequestScreen({ onBackToLogin }: ResetRequestScreenProps) {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setMessage(null)
    setSubmitting(true)
    try {
      const res = await api.requestPasswordReset(email.trim())
      setMessage(res.message)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the request. Please try again.')
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
        <p className="auth-intro">Reset your password</p>

        {message !== null && <p className="alert alert-success" role="status">{message}</p>}
        {error !== null && <p className="alert alert-error" role="alert">{error}</p>}

        <label htmlFor="reset-email">Email</label>
        <input
          id="reset-email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>

        <button type="button" className="btn btn-link" onClick={onBackToLogin}>
          Back to sign in
        </button>
      </form>
    </div>
  )
}

interface ResetConfirmScreenProps {
  token: string
  onDone: () => void
}

export function ResetConfirmScreen({ token, onDone }: ResetConfirmScreenProps) {
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setMessage(null)
    setSubmitting(true)
    try {
      const res = await api.confirmPasswordReset(token, newPassword)
      setMessage(res.message)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password. Please try again.')
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
        <p className="auth-intro">Choose a new password</p>

        {message !== null && <p className="alert alert-success" role="status">{message}</p>}
        {error !== null && <p className="alert alert-error" role="alert">{error}</p>}

        <label htmlFor="reset-new-password">New password</label>
        <input
          id="reset-new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Resetting…' : message !== null ? 'Password reset' : 'Reset password'}
        </button>

        {message !== null && (
          <button type="button" className="btn btn-link" onClick={onDone}>
            Back to sign in
          </button>
        )}
      </form>
    </div>
  )
}