import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { claimAndProcessOne, recoverStuckJobs, setSendFailurePredicate, clearSendFailurePredicate, startProcessor, stopProcessor } from '../processor.js'

const prisma = new PrismaClient()

async function createRestaurant(
  email: string,
  status: 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE',
) {
  return prisma.restaurant.create({
    data: {
      name: `Processor Test ${email}`,
      email,
      passwordHash: 'hash',
      status,
    },
  })
}

async function createOrder(restaurantId: string, phone: string) {
  return prisma.order.create({
    data: {
      restaurantId,
      displayToken: `proc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      customerPhone: phone,
      consentGiven: true,
      consentMethod: 'VERBAL_STAFF_CONFIRMED',
      status: 'READY',
    },
  })
}

async function createAttempt(orderId: string) {
  return prisma.notificationAttempt.create({
    data: {
      orderId,
      attemptNumber: 1,
      channel: 'WHATSAPP',
      jobStatus: 'PENDING',
    },
  })
}

describe('Notification Processor (Phase 9)', () => {
  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    clearSendFailurePredicate()
  })

  describe('Claiming', () => {
    it('should claim one PENDING attempt and move it to PROCESSING', async () => {
      const restaurant = await createRestaurant(`claim-ok-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558001')
      const attempt = await createAttempt(order.id)

      const claimed = await claimAndProcessOne()

      expect(claimed).toBe(true)

      const updated = await prisma.notificationAttempt.findUnique({
        where: { id: attempt.id },
      })
      expect(updated!.jobStatus).toBe('SENT')
      expect(updated!.claimedAt).not.toBeNull()
      expect(updated!.sentAt).not.toBeNull()

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should claim only one attempt even when multiple are PENDING', async () => {
      const restaurant = await createRestaurant(`claim-one-${Date.now()}@ex.com`)
      const order1 = await createOrder(restaurant.id, '+14155558002')
      const order2 = await createOrder(restaurant.id, '+14155558003')
      const attempt1 = await createAttempt(order1.id)
      const attempt2 = await createAttempt(order2.id)

      const claimed = await claimAndProcessOne()
      expect(claimed).toBe(true)

      const a1 = await prisma.notificationAttempt.findUnique({ where: { id: attempt1.id } })
      const a2 = await prisma.notificationAttempt.findUnique({ where: { id: attempt2.id } })

      const sentCount = [a1!.jobStatus, a2!.jobStatus].filter((s) => s === 'SENT').length
      const pendingCount = [a1!.jobStatus, a2!.jobStatus].filter((s) => s === 'PENDING').length
      expect(sentCount).toBe(1)
      expect(pendingCount).toBe(1)

      await prisma.order.deleteMany({ where: { restaurantId: restaurant.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should return false when no PENDING attempts exist', async () => {
      const claimed = await claimAndProcessOne()
      expect(claimed).toBe(false)
    })

    it('should handle concurrent claim calls deterministically', async () => {
      const restaurant = await createRestaurant(`claim-conc-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558004')
      const attempt = await createAttempt(order.id)

      const results = await Promise.all([
        claimAndProcessOne(),
        claimAndProcessOne(),
      ])

      const sentCount = results.filter((r) => r === true).length
      expect(sentCount).toBe(1)

      const final = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(final!.jobStatus).toBe('SENT')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('Mock sender failure', () => {
    it('should transition to FAILED when sender throws', async () => {
      const restaurant = await createRestaurant(`fail-send-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558010')
      const attempt = await createAttempt(order.id)

      setSendFailurePredicate(() => true)

      const claimed = await claimAndProcessOne()
      expect(claimed).toBe(true)

      const final = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(final!.jobStatus).toBe('FAILED')
      expect(final!.failedAt).not.toBeNull()

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('Stuck-job recovery (FR-034)', () => {
    it('should recover PROCESSING jobs stuck beyond threshold', async () => {
      const restaurant = await createRestaurant(`stuck-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558020')
      const attempt = await createAttempt(order.id)

      const oldClaimedAt = new Date(Date.now() - 3 * 60 * 1000)
      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: {
          jobStatus: 'PROCESSING',
          claimedAt: oldClaimedAt,
        },
      })

      const recovered = await recoverStuckJobs(2 * 60 * 1000)
      expect(recovered).toBe(1)

      const final = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(final!.jobStatus).toBe('PENDING')
      expect(final!.claimedAt).toBeNull()

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should not recover PROCESSING jobs within threshold', async () => {
      const restaurant = await createRestaurant(`recent-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558021')
      const attempt = await createAttempt(order.id)

      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: {
          jobStatus: 'PROCESSING',
          claimedAt: new Date(),
        },
      })

      const recovered = await recoverStuckJobs(2 * 60 * 1000)
      expect(recovered).toBe(0)

      const final = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(final!.jobStatus).toBe('PROCESSING')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('Deactivated-restaurant exclusion (FR-029)', () => {
    it('should not claim PENDING attempt for DEACTIVATED restaurant', async () => {
      const restaurant = await createRestaurant(`deact-${Date.now()}@ex.com`, 'DEACTIVATED')
      const order = await createOrder(restaurant.id, '+14155558030')
      const attempt = await createAttempt(order.id)

      const claimed = await claimAndProcessOne()
      expect(claimed).toBe(false)

      const final = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(final!.jobStatus).toBe('PENDING')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should claim PENDING attempt for ACTIVE restaurant', async () => {
      const restaurant = await createRestaurant(`active-${Date.now()}@ex.com`, 'ACTIVE')
      const order = await createOrder(restaurant.id, '+14155558031')
      const attempt = await createAttempt(order.id)

      const claimed = await claimAndProcessOne()
      expect(claimed).toBe(true)

      const final = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(final!.jobStatus).toBe('SENT')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('Processor loop', () => {
    afterEach(() => {
      stopProcessor()
    })

    it('should claim and recover in a single tick', async () => {
      const restaurant = await createRestaurant(`loop-${Date.now()}@ex.com`)

      const order1 = await createOrder(restaurant.id, '+14155558040')
      const attempt1 = await createAttempt(order1.id)

      const order2 = await createOrder(restaurant.id, '+14155558041')
      const attempt2 = await createAttempt(order2.id)
      await prisma.notificationAttempt.update({
        where: { id: attempt2.id },
        data: {
          jobStatus: 'PROCESSING',
          claimedAt: new Date(Date.now() - 3 * 60 * 1000),
        },
      })

      startProcessor(100)
      await new Promise((r) => setTimeout(r, 300))
      stopProcessor()

      const a1 = await prisma.notificationAttempt.findUnique({ where: { id: attempt1.id } })
      const a2 = await prisma.notificationAttempt.findUnique({ where: { id: attempt2.id } })

      expect(a1!.jobStatus).toBe('SENT')
      expect(a2!.jobStatus).toBe('SENT')

      await prisma.order.deleteMany({ where: { restaurantId: restaurant.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })
})
