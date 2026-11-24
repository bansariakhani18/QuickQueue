import { PrismaClient, Prisma } from '@prisma/client'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { getTemplateIdentifierFromEnv } from './whatsappClient.js'

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
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { status: true },
  })
  if (restaurant?.status === 'DEACTIVATED') {
    throw new RestaurantDeactivatedError('Restaurant is deactivated')
  }

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

export interface NotificationAttemptSummary {
  attemptNumber: number
  jobStatus: string
}

export interface ActiveOrderRecord extends OrderRecord {
  mostRecentAttempt: NotificationAttemptSummary | null
  optOutActive: boolean
}

export async function listActiveOrders(
  restaurantId: string,
  options?: ListOrdersOptions,
): Promise<ActiveOrderRecord[]> {
  const where: Prisma.OrderWhereInput = {
    restaurantId,
    status: { in: ['PREPARING', 'READY'] },
  }

  if (options?.search) {
    const rawSearch = options.search.trim()
    const digitsOnly = rawSearch.replace(/\D/g, '')

    const orConditions: Prisma.OrderWhereInput[] = [{ displayToken: rawSearch }]

    if (rawSearch.startsWith('+')) {
      orConditions.push({ customerPhone: rawSearch })
    }
    if (digitsOnly.length > 0) {
      orConditions.push({ customerPhone: { contains: digitsOnly } })
    }

    where.OR = orConditions
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: [
      { status: 'asc' },
      { createdAt: 'asc' },
    ],
    include: {
      notificationAttempts: {
        orderBy: { attemptNumber: 'desc' },
        take: 1,
      },
    },
  })

  const optOutPhones = orders
    .map((o) => o.customerPhone)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)

  let optedOutPhones = new Set<string>()
  if (optOutPhones.length > 0) {
    const optOuts = await prisma.notificationOptOut.findMany({
      where: { restaurantId, phoneNormalized: { in: optOutPhones } },
      select: { phoneNormalized: true },
    })
    optedOutPhones = new Set(optOuts.map((o) => o.phoneNormalized))
  }

  return orders
    .sort((a, b) => {
      if (a.status === 'READY' && b.status !== 'READY') return -1
      if (a.status !== 'READY' && b.status === 'READY') return 1
      return a.createdAt.getTime() - b.createdAt.getTime()
    })
    .map((o) => {
      const attempt = o.notificationAttempts[0] ?? null
      return {
        id: o.id,
        restaurantId: o.restaurantId,
        displayToken: o.displayToken,
        customerPhone: o.customerPhone,
        consentGiven: o.consentGiven,
        consentCapturedAt: o.consentCapturedAt,
        consentMethod: o.consentMethod,
        status: o.status,
        readyAt: o.readyAt,
        collectedAt: o.collectedAt,
        cancelledAt: o.cancelledAt,
        terminalAt: o.terminalAt,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        mostRecentAttempt: attempt
          ? { attemptNumber: attempt.attemptNumber, jobStatus: attempt.jobStatus }
          : null,
        optOutActive: o.customerPhone !== null && optedOutPhones.has(o.customerPhone),
      }
    })
}

export type TransitionStatus = 'READY' | 'COLLECTED' | 'CANCELLED'

const ALLOWED_TRANSITIONS: Record<string, TransitionStatus[]> = {
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COLLECTED', 'CANCELLED'],
}

export async function transitionOrderStatus(
  restaurantId: string,
  orderId: string,
  targetStatus: TransitionStatus,
  options?: { onBeforeAttemptInsert?: () => void | never },
): Promise<OrderRecord> {
  return prisma.$transaction(async (tx) => {
    if (targetStatus === 'READY') {
      const restaurant = await tx.restaurant.findUnique({
        where: { id: restaurantId },
        select: { status: true },
      })
      if (restaurant?.status === 'DEACTIVATED') {
        throw new RestaurantDeactivatedError('Restaurant is deactivated')
      }
    }

    const rows = await tx.$queryRaw<
      { id: string; status: string }[]
    >`SELECT id, status FROM orders WHERE id = ${orderId} AND restaurant_id = ${restaurantId} FOR UPDATE`

    if (rows.length === 0) {
      throw new OrderNotFoundError(`Order ${orderId} not found`)
    }

    const row = rows[0]!
    const currentStatus = row.status

    if (currentStatus === targetStatus && targetStatus === 'READY') {
      const order = await tx.order.findUnique({ where: { id: orderId } })
      return order!
    }

    const allowed = ALLOWED_TRANSITIONS[currentStatus]
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new TransitionError(
        `Cannot transition from ${currentStatus} to ${targetStatus}`,
      )
    }

    const now = new Date()
    const updateData: Record<string, unknown> = { status: targetStatus }

    if (targetStatus === 'READY') {
      updateData.readyAt = now
    } else if (targetStatus === 'COLLECTED') {
      updateData.collectedAt = now
      updateData.terminalAt = now
    } else if (targetStatus === 'CANCELLED') {
      updateData.cancelledAt = now
      updateData.terminalAt = now
    }

    const order = await tx.order.update({
      where: { id: orderId },
      data: updateData,
    })

    if (targetStatus === 'READY') {
      if (!order.consentGiven) {
        return order
      }

      const optOut = await tx.notificationOptOut.findUnique({
        where: {
          restaurantId_phoneNormalized: {
            restaurantId,
            phoneNormalized: order.customerPhone ?? '',
          },
        },
      })

      if (optOut) {
        return order
      }

      options?.onBeforeAttemptInsert?.()

      await tx.notificationAttempt.create({
        data: {
          orderId: order.id,
          attemptNumber: 1,
          channel: 'WHATSAPP',
          jobStatus: 'PENDING',
          templateIdentifierSnapshot: getTemplateIdentifierFromEnv(),
        },
      })
    }

    return order
  })
}

export class OrderNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderNotFoundError'
  }
}

export class TransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransitionError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class RestaurantDeactivatedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestaurantDeactivatedError'
  }
}
