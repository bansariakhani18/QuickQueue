import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import {
  submitWhatsAppDisplayName,
  DisplayNameRegistrationUnavailableError,
} from '../whatsappClient.js'

describe('Real submitWhatsAppDisplayName boundary (Phase 15 step 4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to fabricate a display-name registration until the real Meta contract is confirmed', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      submitWhatsAppDisplayName({
        apiVersion: 'v21.0',
        wabaId: 'WABA-BOUNDARY',
        phoneNumberId: 'PHONE-BOUNDARY',
        accessToken: 'EAAX-boundary-secret',
        requestedDisplayName: 'Pizza Place via QuickQueue',
      }),
    ).rejects.toBeInstanceOf(DisplayNameRegistrationUnavailableError)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not configure tokens or identifiers into any error surface', async () => {
    await expect(
      submitWhatsAppDisplayName({
        apiVersion: 'v21.0',
        wabaId: 'WABA-BOUNDARY',
        phoneNumberId: 'PHONE-BOUNDARY',
        accessToken: 'EAAX-boundary-secret',
        requestedDisplayName: 'Pizza Place via QuickQueue',
      }),
    ).rejects.toThrow(/External Validation Dependency/)
  })
})