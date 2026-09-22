import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSendFailurePredicate,
  createRealWhatsAppSender,
  getNotificationSender,
  setNotificationSender,
  setSendFailurePredicate,
  type NotificationPayload,
} from '../processor.js'
import { getConfigFromEnv, sendWhatsAppTemplate } from '../whatsappClient.js'

vi.mock('../whatsappClient.js', () => ({
  getConfigFromEnv: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
}))

const payload: NotificationPayload = {
  orderId: 'order-1',
  restaurantId: 'restaurant-1',
  customerPhone: '+15551234567',
}

const mockConfig = {
  phoneNumberId: 'phone-id-1',
  accessToken: 'token',
  templateName: 'jaspers_market_plain_text_v1',
  templateLanguage: 'en_US',
  apiVersion: 'v21.0',
}

describe('WhatsApp sender wiring (Phase 12)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSendFailurePredicate()
  })

  it('returns null sender when no WhatsApp config is available', () => {
    vi.mocked(getConfigFromEnv).mockReturnValue(null)
    expect(createRealWhatsAppSender()).toBeNull()
  })

  it('creates a real sender that sends the QuickQueue template to the customer phone', async () => {
    vi.mocked(getConfigFromEnv).mockReturnValue(mockConfig)
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ providerMessageId: 'wamid-mock-1' })

    const sender = createRealWhatsAppSender()
    expect(sender).not.toBeNull()

    const result = await sender!.send(payload)

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ to: '+15551234567' }),
    )
    expect(result.providerMessageId).toBe('wamid-mock-1')
  })

  it('installs and returns a sender through the set/get seam', () => {
    const original = getNotificationSender()
    const real = createRealWhatsAppSender() ?? original
    setNotificationSender(real)
    expect(getNotificationSender()).toBe(real)
    setNotificationSender(original)
  })

  it('default sender is a mock that returns a providerMessageId on success', async () => {
    const result = await getNotificationSender().send(payload)
    expect(result.providerMessageId).toMatch(/^mock-message-id-/)
  })

  it('default sender throws a transient failure when the failure predicate fires', async () => {
    setSendFailurePredicate(() => 'transient')
    await expect(getNotificationSender().send(payload)).rejects.toThrow('Mock transient failure')
  })
})