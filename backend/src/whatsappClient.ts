export interface WhatsAppConfig {
  phoneNumberId: string
  accessToken: string
  templateName: string
  templateLanguage: string
  apiVersion: string
}

export interface WhatsAppTemplateMessage {
  to: string
  bodyParameters?: string[]
}

export interface WhatsAppSendResult {
  providerMessageId: string
}

export interface MetaErrorInfo {
  message?: string
  type?: string
  code?: number
  errorSubcode?: number
  fbtraceId?: string
}

export class WhatsAppApiError extends Error {
  readonly status: number | undefined
  readonly meta: MetaErrorInfo | undefined
  readonly rawBody: string | undefined

  constructor(
    message: string,
    options: {
      status?: number
      meta?: MetaErrorInfo
      rawBody?: string
    } = {},
  ) {
    super(message)
    this.name = 'WhatsAppApiError'
    this.status = options.status
    this.meta = options.meta
    this.rawBody = options.rawBody
  }
}

export function getConfigFromEnv(): WhatsAppConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? ''
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? ''
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME?.trim() ?? ''
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() ?? ''
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() ?? ''

  if (!phoneNumberId || !accessToken || !templateName || !templateLanguage || !apiVersion) {
    return null
  }

  return { phoneNumberId, accessToken, templateName, templateLanguage, apiVersion }
}

function parseMetaError(body: unknown): MetaErrorInfo | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const errorField = (body as Record<string, unknown>).error
  if (typeof errorField !== 'object' || errorField === null) return undefined
  const error = errorField as Record<string, unknown>

  const meta: MetaErrorInfo = {}
  if (typeof error.message === 'string') meta.message = error.message
  if (typeof error.type === 'string') meta.type = error.type
  if (typeof error.code === 'number') meta.code = error.code
  if (typeof error.error_subcode === 'number') meta.errorSubcode = error.error_subcode
  if (typeof error.fbtrace_id === 'string') meta.fbtraceId = error.fbtrace_id
  return meta
}

export async function sendWhatsAppTemplate(
  config: WhatsAppConfig,
  message: WhatsAppTemplateMessage,
): Promise<WhatsAppSendResult> {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`

  const template: {
    name: string
    language: { code: string }
    components?: Array<{ type: 'body'; parameters: Array<{ type: 'text'; text: string }> }>
  } = {
    name: config.templateName,
    language: { code: config.templateLanguage },
  }

  if (message.bodyParameters && message.bodyParameters.length > 0) {
    template.components = [
      {
        type: 'body',
        parameters: message.bodyParameters.map((text) => ({ type: 'text' as const, text })),
      },
    ]
  }

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to,
    type: 'template',
    template,
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new WhatsAppApiError('Network error calling WhatsApp Cloud API')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    if (!response.ok) {
      throw new WhatsAppApiError(`WhatsApp Cloud API returned HTTP ${response.status} with a non-JSON body`, {
        status: response.status,
      })
    }
    throw new WhatsAppApiError('WhatsApp Cloud API returned a non-JSON success payload', {
      status: response.status,
    })
  }

  if (!response.ok) {
    const meta = parseMetaError(payload)
    throw new WhatsAppApiError(`WhatsApp Cloud API returned HTTP ${response.status}`, {
      status: response.status,
      ...(meta ? { meta } : {}),
      rawBody: JSON.stringify(payload),
    })
  }

  const success = payload as Record<string, unknown>
  const messages = success.messages
  const providerMessageId =
    Array.isArray(messages) && typeof messages[0] === 'object' && messages[0] !== null
      ? (messages[0] as Record<string, unknown>).id
      : undefined

  if (typeof providerMessageId !== 'string' || providerMessageId === '') {
    throw new WhatsAppApiError('WhatsApp Cloud API success payload did not include a message id', {
      status: response.status,
      rawBody: JSON.stringify(payload),
    })
  }

  return { providerMessageId }
}