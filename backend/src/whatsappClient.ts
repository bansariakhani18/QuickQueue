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

export interface WhatsAppTemplateIdentity {
  templateName: string
  templateLanguage: string
  apiVersion: string
}

export function getTemplateIdentityFromEnv(): WhatsAppTemplateIdentity | null {
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME?.trim() ?? ''
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() ?? ''
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() ?? ''

  if (!templateName || !templateLanguage || !apiVersion) {
    return null
  }

  return { templateName, templateLanguage, apiVersion }
}

export function getTemplateIdentifierFromEnv(): string | null {
  const identity = getTemplateIdentityFromEnv()
  if (!identity) return null
  return `${identity.templateName}|${identity.templateLanguage}|${identity.apiVersion}`
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

export interface DisplayNameSubmissionInput {
  apiVersion: string
  wabaId: string
  phoneNumberId: string
  accessToken: string
  requestedDisplayName: string
}

export type DisplayNameSubmissionResult =
  | { status: 'APPROVED'; approvedDisplayName: string }
  | { status: 'REJECTED'; rejectedDisplayName: string }

export class DisplayNameRegistrationUnavailableError extends Error {
  constructor(
    message = 'Meta display-name registration is not implemented: the exact endpoint, request body, response fields, and approval semantics are an unvalidated External Validation Dependency (SRS Section 22). No Meta request is issued and no display name is claimed approved until the real contract is confirmed.',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DisplayNameRegistrationUnavailableError'
  }
}

export async function submitWhatsAppDisplayName(
  _input: DisplayNameSubmissionInput,
): Promise<DisplayNameSubmissionResult> {
  throw new DisplayNameRegistrationUnavailableError()
}

export interface TemplateProvisioningInput {
  apiVersion: string
  wabaId: string
  accessToken: string
  templateName: string
  templateLanguage: string
}

export type TemplateProvisioningResult = { status: 'PROVISIONED' } | { status: 'NOT_PROVISIONED' }

export class TemplateProvisioningUnavailableError extends Error {
  constructor(
    message = 'WhatsApp template provisioning is not implemented: the exact endpoint, request body, response fields, and approval/creation semantics are an unvalidated External Validation Dependency (SRS Section 22). No Meta request is issued and no template is claimed provisioned until the real contract is confirmed.',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TemplateProvisioningUnavailableError'
  }
}

export async function submitWhatsAppTemplateProvisioning(
  _input: TemplateProvisioningInput,
): Promise<TemplateProvisioningResult> {
  throw new TemplateProvisioningUnavailableError()
}