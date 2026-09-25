import { PrismaClient } from '@prisma/client'
import { encryptToken, TokenEncryptionError } from './crypto.js'
import {
  getTemplateIdentityFromEnv,
  submitWhatsAppDisplayName,
  submitWhatsAppTemplateProvisioning,
  type TemplateProvisioningResult,
} from './whatsappClient.js'
import {
  resolveRestaurantWhatsAppCredentials,
  WhatsAppSenderUnavailableError,
} from './processor.js'

const prisma = new PrismaClient()

export class ConnectionEncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConnectionEncryptionError'
  }
}

export interface EmbeddedSignupCompletionInput {
  wabaId: string
  phoneNumberId: string
  accessToken: string
}

export type ConnectionStatusValue =
  | 'NOT_CONNECTED'
  | 'PENDING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'

export async function getConnectionStatus(restaurantId: string): Promise<{
  connectionStatus: ConnectionStatusValue
  connectedAt: Date | null
}> {
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { restaurantId },
    select: { connectionStatus: true, connectedAt: true },
  })
  if (!connection) {
    return { connectionStatus: 'NOT_CONNECTED', connectedAt: null }
  }
  return {
    connectionStatus: connection.connectionStatus as ConnectionStatusValue,
    connectedAt: connection.connectedAt,
  }
}

export async function initiateEmbeddedSignup(restaurantId: string) {
  const existing = await prisma.whatsAppConnection.findUnique({ where: { restaurantId } })
  if (existing?.connectionStatus === 'CONNECTED') {
    return { connectionStatus: existing.connectionStatus }
  }
  const connection = await prisma.whatsAppConnection.upsert({
    where: { restaurantId },
    create: { restaurantId, connectionStatus: 'PENDING' },
    update: { connectionStatus: 'PENDING' },
  })
  return { connectionStatus: connection.connectionStatus }
}

export async function completeEmbeddedSignup(
  restaurantId: string,
  input: EmbeddedSignupCompletionInput,
) {
  let accessTokenEncrypted: string
  try {
    accessTokenEncrypted = encryptToken(input.accessToken)
  } catch (err) {
    if (err instanceof TokenEncryptionError) {
      throw new ConnectionEncryptionError('Token encryption is not configured', { cause: err })
    }
    throw err
  }

  const connection = await prisma.whatsAppConnection.upsert({
    where: { restaurantId },
    create: {
      restaurantId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      accessTokenEncrypted,
      connectionStatus: 'CONNECTED',
      connectedAt: new Date(),
    },
    update: {
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      accessTokenEncrypted,
      connectionStatus: 'CONNECTED',
      connectedAt: new Date(),
      disconnectedAt: null,
    },
  })

  return connection
}

export function buildRequestedWhatsAppDisplayName(restaurantName: string): string {
  const name = restaurantName.trim()
  if (name === '') {
    throw new Error('Restaurant name is required to build a WhatsApp display name')
  }
  return `${name} via QuickQueue`
}

export class DisplayNameRegistrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DisplayNameRegistrationError'
  }
}

export class TemplateProvisioningError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TemplateProvisioningError'
  }
}

export type DisplayNameRegistrationOutcome =
  | { status: 'ALREADY_APPROVED'; approvedDisplayName: string }
  | { status: 'APPROVED'; requestedDisplayName: string; approvedDisplayName: string }
  | { status: 'NO_APPROVAL'; requestedDisplayName: string; approvedDisplayName: null }

export async function registerWhatsAppDisplayName(
  restaurantId: string,
): Promise<DisplayNameRegistrationOutcome> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } })
  if (!restaurant) {
    throw new DisplayNameRegistrationError('Restaurant not found')
  }

  const connectionRow = await prisma.whatsAppConnection.findUnique({ where: { restaurantId } })
  if (connectionRow?.approvedDisplayName) {
    return {
      status: 'ALREADY_APPROVED',
      approvedDisplayName: connectionRow.approvedDisplayName,
    }
  }

  const templateIdentity = getTemplateIdentityFromEnv()
  if (!templateIdentity) {
    throw new DisplayNameRegistrationError(
      'WhatsApp API version is not configured; display name registration cannot be attempted',
    )
  }

  const { phoneNumberId, accessToken } = await resolveRestaurantWhatsAppCredentials(restaurantId)
  const wabaId = connectionRow?.wabaId ?? null
  if (!wabaId) {
    throw new DisplayNameRegistrationError(
      `WhatsApp connection for restaurant ${restaurantId} has no WABA ID; display name registration cannot be attempted`,
    )
  }

  const requestedDisplayName = buildRequestedWhatsAppDisplayName(restaurant.name)

  const first = await submitWhatsAppDisplayName({
    apiVersion: templateIdentity.apiVersion,
    wabaId,
    phoneNumberId,
    accessToken,
    requestedDisplayName,
  })
  if (first.status === 'APPROVED') {
    await prisma.whatsAppConnection.update({
      where: { restaurantId },
      data: { approvedDisplayName: first.approvedDisplayName },
    })
    return { status: 'APPROVED', requestedDisplayName, approvedDisplayName: first.approvedDisplayName }
  }

  const second = await submitWhatsAppDisplayName({
    apiVersion: templateIdentity.apiVersion,
    wabaId,
    phoneNumberId,
    accessToken,
    requestedDisplayName: restaurant.name.trim(),
  })
  if (second.status === 'APPROVED') {
    await prisma.whatsAppConnection.update({
      where: { restaurantId },
      data: { approvedDisplayName: second.approvedDisplayName },
    })
    return { status: 'APPROVED', requestedDisplayName, approvedDisplayName: second.approvedDisplayName }
  }

  return { status: 'NO_APPROVAL', requestedDisplayName, approvedDisplayName: null }
}

export async function provisionRestaurantWhatsAppTemplate(
  restaurantId: string,
): Promise<TemplateProvisioningResult> {
  const connectionRow = await prisma.whatsAppConnection.findUnique({ where: { restaurantId } })
  if (!connectionRow) {
    throw new WhatsAppSenderUnavailableError(
      'CONNECTION_NOT_FOUND',
      `No WhatsApp connection found for restaurant ${restaurantId}`,
    )
  }

  const wabaId = connectionRow.wabaId ?? null
  if (!wabaId) {
    throw new TemplateProvisioningError(
      `WhatsApp connection for restaurant ${restaurantId} has no WABA ID; template provisioning cannot be attempted`,
    )
  }

  const templateIdentity = getTemplateIdentityFromEnv()
  if (!templateIdentity) {
    throw new TemplateProvisioningError(
      'WhatsApp template configuration is missing; template provisioning cannot be attempted',
    )
  }

  const { accessToken } = await resolveRestaurantWhatsAppCredentials(restaurantId)

  return submitWhatsAppTemplateProvisioning({
    apiVersion: templateIdentity.apiVersion,
    wabaId,
    accessToken,
    templateName: templateIdentity.templateName,
    templateLanguage: templateIdentity.templateLanguage,
  })
}