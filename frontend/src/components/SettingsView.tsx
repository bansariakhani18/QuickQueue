import { WhatsAppConnectionPanel } from './WhatsAppConnectionPanel'
import type { RestaurantUser } from '../types'

interface SettingsViewProps {
  user: RestaurantUser | null
  onUnauthorized: () => void
}

function IconStore() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function IconBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  )
}

export function SettingsView({ user, onUnauthorized }: SettingsViewProps) {
  return (
    <div className="settings-view" style={{ maxWidth: '820px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="settings-header">
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--ink)' }}>Settings &amp; Profile</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.95rem', marginTop: '0.25rem' }}>
          Manage your restaurant profile, WhatsApp connection, and notification rules.
        </p>
      </div>

      {/* Restaurant Profile Card */}
      <section className="settings-card" aria-label="Profile and restaurant details">
        <div className="settings-card-header">
          <div className="settings-card-icon" aria-hidden="true"><IconStore /></div>
          <div>
            <h3 className="settings-card-title">Profile &amp; Restaurant Details</h3>
            <p className="settings-card-subtitle">Information displayed to customers and staff.</p>
          </div>
        </div>

        <div className="settings-card-body" style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
          <div className="info-item">
            <span className="info-label">Restaurant Name</span>
            <span className="info-value">{user?.name ?? '—'}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Account Email</span>
            <span className="info-value">{user?.email ?? '—'}</span>
          </div>
        </div>
      </section>

      {/* WhatsApp Integration Card */}
      <WhatsAppConnectionPanel onUnauthorized={onUnauthorized} />

      {/* Notification Preferences Card */}
      <section className="settings-card" aria-label="Notification preferences">
        <div className="settings-card-header">
          <div className="settings-card-icon" aria-hidden="true"><IconBell /></div>
          <div>
            <h3 className="settings-card-title">Notification Preferences</h3>
            <p className="settings-card-subtitle">Configure automated customer alert triggers.</p>
          </div>
        </div>

        <div className="settings-card-body" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="pref-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Order Ready notification</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Automatically alerts customer on WhatsApp when marked Ready.</div>
            </div>
            <span className="badge badge-emerald" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.65rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }}>
              <span aria-hidden="true">●</span> Active
            </span>
          </div>

          <div className="pref-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Order Preparing notification</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Send &ldquo;Order being prepared&rdquo; notification when order is created.</div>
            </div>
            <span className="badge badge-subtle" style={{ padding: '0.3rem 0.65rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, background: '#F1F5F9', color: '#64748B' }}>
              Coming soon
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
