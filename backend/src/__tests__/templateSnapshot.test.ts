import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, transitionOrderStatus } from '../orders.js'
import { recallOrder } from '../processor.js'
import { getTemplateIdentifierFromEnv } from '../whatsappClient.js'

const prisma = new PrismaClient()

const ENV_KEYS = ['WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_TEMPLATE_LANGUAGE', 'WHATSAPP_API_VERSION'] as const
const originalEnv: Record<string, string | undefined> = {}

async function createRestaurant(email: string) {
  return prisma.restaurant.create({
    data: { name: 'Snapshot Test', email, passwordHash: 'hash' },
  })
}

async function createOrderRecord(restaurantId: string) {
  return createOrder(restaurantId, {
    displayToken: `snap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    customerPhone: '+14155558099',
    consentGiven: true,
  })
}

async function cleanup(restaurant: { id: string }, order: { id: string }, attempts: Array<{ id: string }>) {
  const orderAttempts = attempts.map((a) =>
    prisma.notificationAttempt.delete({ where: { id: a.id } }),
  )
  await Promise.all(orderAttempts)
  await prisma.order.delete({ where: { id: order.id } })
  await prisma.restaurant.delete({ where: { id: restaurant.id } })
}

describe('Template identifier snapshots on notification attempts (Phase 15 step 5, FR-045)', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key]
    }
    process.env.WHATSAPP_TEMPLATE_NAME = 'quickqueue_order_ready_v1'
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'en_US'
    process.env.WHATSAPP_API_VERSION = 'v21.0'
    await prisma.$connect()
  })

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      const original = originalEnv[key]
      if (original === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original
      }
    }
    await prisma.$disconnect()
  })

  it('records the configured template identifier on the READY-created notification attempt', async () => {
    const restaurant = await createRestaurant(`snap-ready-${Date.now()}@ex.com`)
    const order = await createOrderRecord(restaurant.id)

    await transitionOrderStatus(restaurant.id, order.id, 'READY')

    const attempts = await prisma.notificationAttempt.findMany({ where: { orderId: order.id } })
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.attemptNumber).toBe(1)
    expect(attempts[0]!.jobStatus).toBe('PENDING')
    expect(attempts[0]!.templateIdentifierSnapshot).toBe(getTemplateIdentifierFromEnv())
    expect(attempts[0]!.templateIdentifierSnapshot).not.toBeNull()

    await cleanup(restaurant, order, attempts)
  })

  it('records the configured template identifier on the RECALL-created notification attempt', async () => {
    const restaurant = await createRestaurant(`snap-recall-${Date.now()}@ex.com`)
    const order = await createOrderRecord(restaurant.id)

    await transitionOrderStatus(restaurant.id, order.id, 'READY')
    const first = await prisma.notificationAttempt.findFirst({ where: { orderId: order.id } })
    const sent = await prisma.notificationAttempt.update({
      where: { id: first!.id },
      data: { jobStatus: 'SENT', sentAt: new Date() },
    })

    const recall = await recallOrder(restaurant.id, order.id)
    expect(recall.attemptNumber).toBe(2)

    const second = await prisma.notificationAttempt.findFirst({
      where: { orderId: order.id, attemptNumber: 2 },
    })
    expect(second!.jobStatus).toBe('PENDING')
    expect(second!.templateIdentifierSnapshot).toBe(getTemplateIdentifierFromEnv())
    expect(second!.templateIdentifierSnapshot).not.toBeNull()

    const attempts = await prisma.notificationAttempt.findMany({ where: { orderId: order.id } })
    await cleanup(restaurant, order, attempts)
    void sent
  })

  it('records a null snapshot (rather than crashing the transition) when template config is absent', async () => {
    const original = process.env.WHATSAPP_TEMPLATE_LANGUAGE
    delete process.env.WHATSAPP_TEMPLATE_LANGUAGE
    try {
      const restaurant = await createRestaurant(`snap-null-${Date.now()}@ex.com`)
      const order = await createOrderRecord(restaurant.id)

      await transitionOrderStatus(restaurant.id, order.id, 'READY')

      const attempts = await prisma.notificationAttempt.findMany({ where: { orderId: order.id } })
      expect(attempts).toHaveLength(1)
      expect(attempts[0]!.templateIdentifierSnapshot).toBeNull()

      await cleanup(restaurant, order, attempts)
    } finally {
      process.env.WHATSAPP_TEMPLATE_LANGUAGE = original as string
    }
  })
})