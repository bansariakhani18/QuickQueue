import { useState } from 'react'
import { api, ApiError } from '../api'
import { COUNTRIES, DEFAULT_DIAL_CODE } from '../phoneCountries'

interface OrderCreateFormProps {
  onCreated: () => void
  onUnauthorized: () => void
}

export function OrderCreateForm({ onCreated, onUnauthorized }: OrderCreateFormProps) {
  const [displayToken, setDisplayToken] = useState('')
  const [countryDialCode, setCountryDialCode] = useState(DEFAULT_DIAL_CODE)
  const [nationalNumber, setNationalNumber] = useState('')
  const [consentGiven, setConsentGiven] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    const trimmedInput = nationalNumber.trim()
    let customerPhone = ''
    if (trimmedInput.startsWith('+')) {
      const digits = trimmedInput.slice(1).replace(/\D/g, '')
      customerPhone = digits.length === 0 ? '' : `+${digits}`
    } else {
      let digits = trimmedInput.replace(/\D/g, '')
      if (countryDialCode === '91' && digits.startsWith('0')) {
        digits = digits.replace(/^0+/, '')
      }
      customerPhone = digits.length === 0 ? '' : `+${countryDialCode}${digits}`
    }
    try {
      await api.createOrder({
        displayToken: displayToken.trim(),
        customerPhone,
        consentGiven,
      })
      setDisplayToken('')
      setNationalNumber('')
      setSuccess('Order created')
      onCreated()
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          onUnauthorized()
          return
        }
        if (err.status === 0) {
          onCreated()
          setError('Could not confirm the order was created — showing the latest orders.')
          return
        }
        setError(err.message)
        return
      }
      setError('Could not create the order. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <div className="create-row">
        <div className="field">
          <label htmlFor="create-token">Display token</label>
          <input
            id="create-token"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoFocus
            placeholder="e.g. 42"
            value={displayToken}
            onChange={(e) => setDisplayToken(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="create-phone">Customer WhatsApp phone</label>
          <div className="phone-field">
            <select
              id="create-country"
              aria-label="Country code"
              value={countryDialCode}
              onChange={(e) => setCountryDialCode(e.target.value)}
            >
              {COUNTRIES.map((country) => (
                <option key={country.dialCode} value={country.dialCode}>
                  +{country.dialCode} · {country.name}
                </option>
              ))}
            </select>
            <input
              id="create-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="e.g. 98765 43210"
              value={nationalNumber}
              onChange={(e) => setNationalNumber(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="consent-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
            />
            Customer agreed to receive a WhatsApp notification
          </label>
        </div>

        <button type="submit" className="btn btn-primary btn-create" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create order'}
        </button>
      </div>

      {error !== null && <p className="alert alert-error" role="alert">{error}</p>}
      {success !== null && <p className="alert alert-success" role="status">{success}</p>}
    </form>
  )
}