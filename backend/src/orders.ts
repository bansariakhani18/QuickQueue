import { PrismaClient, Prisma } from '@prisma/client'
import { parsePhoneNumberFromString } from 'libphonenumber-js'

const prisma = new PrismaClient()

export interface CreateOrderInput {
  displayToken: string
  customerPhone: string
  consentGiven: boolean
}

export interface OrderRecord {
  id: string
  restaurantId: string
  displayToken: string
  customerPhone: string | null
  consentGiven: boolean
  consentCapturedAt: Date
  consentMethod: string | null
  status: string
  readyAt: Date | null
  collectedAt: Date | null
  cancelledAt: Date | null
  terminalAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '')
  const phone = parsePhoneNumberFromString(stripped, 'US')
  if (!phone?.isValid()) {
    throw new PhoneNormalizationError(`Invalid phone number: ${raw}`)
  }
  return phone.number
}

export class PhoneNormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhoneNormalizationError'
  }
}

export async function createOrder(
  restaurantId: string,
  input: CreateOrderInput,
): Promise<OrderRecord> {
  const displayToken = input.displayToken.trim()
  if (!displayToken) {
    throw new ValidationError('Display token is required')
  }

  const normalizedPhone = normalizePhone(input.customerPhone)

  if (typeof input.consentGiven !== 'boolean') {
    throw new ValidationError('Consent must be an explicit true or false value')
  }

  const consentMethod = input.consentGiven ? 'VERBAL_STAFF_CONFIRMED' as const : null

  const order = await prisma.order.create({
    data: {
      restaurantId,
      displayToken,
      customerPhone: normalizedPhone,
      consentGiven: input.consentGiven,
      consentMethod,
      status: 'PREPARING',
    },
  })

  return order
}

export interface ListOrdersOptions {
  search?: string
}

export async function listActiveOrders(
  restaurantId: string,
  options?: ListOrdersOptions,
): Promise<OrderRecord[]> {
  const where: Prisma.OrderWhereInput = {
    restaurantId,
    status: { in: ['PREPARING', 'READY'] },
  }

  if (options?.search) {
    const searchTerm = options.search.trim()
    where.OR = [
      { displayToken: searchTerm },
      { customerPhone: searchTerm },
    ]
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: [
      { status: 'asc' },
      { createdAt: 'asc' },
    ],
  })

  return orders.sort((a, b) => {
    if (a.status === 'READY' && b.status !== 'READY') return -1
    if (a.status !== 'READY' && b.status === 'READY') return 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
