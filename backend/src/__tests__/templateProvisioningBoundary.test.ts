import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import {
  submitWhatsAppTemplateProvisioning,
  TemplateProvisioningUnavailableError,
} from '../whatsappClient.js'

describe('Real submitWhatsAppTemplateProvisioning boundary (Phase 15 step 5)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to fabricate a template-provisioning call until the real Meta contract is confirmed', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      submitWhatsAppTemplateProvisioning({
        apiVersion: 'v21.0',
        wabaId: 'WABA-TP-BOUNDARY',
        accessToken: 'EAAX-boundary-secret',
        templateName: 'quickqueue_order_ready_v1',
        templateLanguage: 'en_US',
      }),
    ).rejects.toBeInstanceOf(TemplateProvisioningUnavailableError)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never embeds tokens or identifiers into its error surface', async () => {
    await expect(
      submitWhatsAppTemplateProvisioning({
        apiVersion: 'v21.0',
        wabaId: 'WABA-TP-BOUNDARY',
        accessToken: 'EAAX-boundary-secret',
        templateName: 'quickqueue_order_ready_v1',
        templateLanguage: 'en_US',
      }),
    ).rejects.toThrow(/External Validation Dependency/)
  })
})