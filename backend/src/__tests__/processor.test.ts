import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  claimAndProcessOne,
  recoverStuckJobs,
  setSendFailurePredicate,
  clearSendFailurePredicate,
  startProcessor,
  stopProcessor,
  recallOrder,
  RecallError,
  type FailureType,
} from '../processor.js'

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

async function createAttempt(orderId: string, attemptNumber = 1) {
  return prisma.notificationAttempt.create({
    data: {
      orderId,
      attemptNumber,
      channel: 'WHATSAPP',
      jobStatus: 'PENDING',
    },
  })
}

function transientFail() {
  return (_payload: { orderId: string; restaurantId: string; customerPhone: string }): FailureType | null => 'transient'
}

function permanentFail() {
  return (_payload: { orderId: string; restaurantId: string; customerPhone: string }): FailureType | null => 'permanent'
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
    it('should claim one PENDING attempt and move it to SENT', async () => {
      const restaurant = await createRestaurant(`claim-ok-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558001')
      const attempt = await createAttempt(order.id)

      const claimed = await claimAndProcessOne()
      expect(claimed).toBe(true)

      const updated = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
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

  describe('Stuck-job recovery (FR-034)', () => {
    it('should recover PROCESSING jobs stuck beyond threshold', async () => {
      const restaurant = await createRestaurant(`stuck-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558020')
      const attempt = await createAttempt(order.id)

      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: {
          jobStatus: 'PROCESSING',
          claimedAt: new Date(Date.now() - 3 * 60 * 1000),
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

describe('Phase 10 — Retry Classification and RECALL', () => {
  const origBackoff = process.env.RETRY_BACKOFF_MS

  beforeAll(async () => {
    await prisma.$connect()
    process.env.RETRY_BACKOFF_MS = '0'
  })

  afterAll(async () => {
    if (origBackoff === undefined) {
      delete process.env.RETRY_BACKOFF_MS
    } else {
      process.env.RETRY_BACKOFF_MS = origBackoff
    }
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    clearSendFailurePredicate()
  })

  describe('Transient failure retry (FR-033)', () => {
    it('should retry up to 3 times on transient failure, staying on same row', async () => {
      const restaurant = await createRestaurant(`retry-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558100')
      const attempt = await createAttempt(order.id)

      let callCount = 0
      setSendFailurePredicate(((_payload: { orderId: string; restaurantId: string; customerPhone: string }) => {
        callCount++
        if (callCount <= 3) return 'transient'
        return null
      }) as (payload: { orderId: string; restaurantId: string; customerPhone: string }) => FailureType | null)

      await claimAndProcessOne()
      let a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(1)
      expect(a!.attemptNumber).toBe(1)
      expect(a!.jobStatus).toBe('PENDING')

      await claimAndProcessOne()
      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(2)
      expect(a!.attemptNumber).toBe(1)
      expect(a!.jobStatus).toBe('PENDING')

      await claimAndProcessOne()
      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(3)
      expect(a!.attemptNumber).toBe(1)
      expect(a!.jobStatus).toBe('PENDING')

      await claimAndProcessOne()
      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(3)
      expect(a!.jobStatus).toBe('SENT')
      expect(a!.attemptNumber).toBe(1)

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should transition to FAILED after max retries exhausted', async () => {
      const restaurant = await createRestaurant(`retry-max-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558101')
      const attempt = await createAttempt(order.id)

      setSendFailurePredicate(transientFail())

      await claimAndProcessOne()
      let a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(1)
      expect(a!.jobStatus).toBe('PENDING')

      await claimAndProcessOne()
      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(2)
      expect(a!.jobStatus).toBe('PENDING')

      await claimAndProcessOne()
      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(3)
      expect(a!.jobStatus).toBe('PENDING')

      await claimAndProcessOne()
      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(3)
      expect(a!.jobStatus).toBe('FAILED')
      expect(a!.failedAt).not.toBeNull()

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should never increment attemptNumber during automatic retries', async () => {
      const restaurant = await createRestaurant(`retry-attnum-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558102')
      const attempt = await createAttempt(order.id)

      setSendFailurePredicate(transientFail())

      for (let i = 0; i < 4; i++) {
        await claimAndProcessOne()
      }

      const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.attemptNumber).toBe(1)
      expect(a!.jobStatus).toBe('FAILED')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should not retry before backoff expires, then retry after', async () => {
      process.env.RETRY_BACKOFF_MS = '500'

      const restaurant = await createRestaurant(`backoff-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558103')
      const attempt = await createAttempt(order.id)

      setSendFailurePredicate(transientFail())

      await claimAndProcessOne()
      let a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(1)
      expect(a!.jobStatus).toBe('PENDING')
      expect(a!.nextRetryAt).not.toBeNull()

      const claimedImmediately = await claimAndProcessOne()
      expect(claimedImmediately).toBe(false)

      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.retryCount).toBe(1)
      expect(a!.jobStatus).toBe('PENDING')

      await new Promise((r) => setTimeout(r, 600))

      clearSendFailurePredicate()
      const claimedAfterBackoff = await claimAndProcessOne()
      expect(claimedAfterBackoff).toBe(true)

      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.jobStatus).toBe('SENT')
      expect(a!.sentAt).not.toBeNull()

      process.env.RETRY_BACKOFF_MS = '0'
      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('Permanent failure (FR-033)', () => {
    it('should transition to FAILED immediately with no retry', async () => {
      const restaurant = await createRestaurant(`perm-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558200')
      const attempt = await createAttempt(order.id)

      setSendFailurePredicate(permanentFail())

      await claimAndProcessOne()
      const a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.jobStatus).toBe('FAILED')
      expect(a!.retryCount).toBe(0)
      expect(a!.failedAt).not.toBeNull()

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should not retry a permanent failure even with retries remaining', async () => {
      const restaurant = await createRestaurant(`perm-retry-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558201')
      const attempt = await createAttempt(order.id)

      setSendFailurePredicate(permanentFail())

      await claimAndProcessOne()
      let a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.jobStatus).toBe('FAILED')

      await claimAndProcessOne()
      a = await prisma.notificationAttempt.findUnique({ where: { id: attempt.id } })
      expect(a!.jobStatus).toBe('FAILED')
      expect(a!.retryCount).toBe(0)

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('RECALL — eligible (FR-035, FR-036, FR-037)', () => {
    it('should create a new attempt with incremented attemptNumber', async () => {
      const restaurant = await createRestaurant(`recall-ok-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558300')
      const initial = await createAttempt(order.id)
      await prisma.notificationAttempt.update({
        where: { id: initial.id },
        data: { jobStatus: 'SENT', sentAt: new Date() },
      })

      const result = await recallOrder(restaurant.id, order.id)
      expect(result.attemptNumber).toBe(2)

      const attempts = await prisma.notificationAttempt.findMany({
        where: { orderId: order.id },
        orderBy: { attemptNumber: 'asc' },
      })
      expect(attempts).toHaveLength(2)
      expect(attempts[0]!.attemptNumber).toBe(1)
      expect(attempts[1]!.attemptNumber).toBe(2)
      expect(attempts[1]!.jobStatus).toBe('PENDING')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should allow up to 3 recalls (4 total attempts)', async () => {
      const restaurant = await createRestaurant(`recall-max-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558301')
      const initial = await createAttempt(order.id)
      await prisma.notificationAttempt.update({
        where: { id: initial.id },
        data: { jobStatus: 'SENT', sentAt: new Date() },
      })

      const r1 = await recallOrder(restaurant.id, order.id)
      expect(r1.attemptNumber).toBe(2)
      await prisma.notificationAttempt.update({
        where: { id: (await prisma.notificationAttempt.findFirst({ where: { orderId: order.id }, orderBy: { attemptNumber: 'desc' } }))!.id },
        data: { jobStatus: 'SENT', sentAt: new Date() },
      })

      const r2 = await recallOrder(restaurant.id, order.id)
      expect(r2.attemptNumber).toBe(3)
      await prisma.notificationAttempt.update({
        where: { id: (await prisma.notificationAttempt.findFirst({ where: { orderId: order.id }, orderBy: { attemptNumber: 'desc' } }))!.id },
        data: { jobStatus: 'SENT', sentAt: new Date() },
      })

      const r3 = await recallOrder(restaurant.id, order.id)
      expect(r3.attemptNumber).toBe(4)
      await prisma.notificationAttempt.update({
        where: { id: (await prisma.notificationAttempt.findFirst({ where: { orderId: order.id }, orderBy: { attemptNumber: 'desc' } }))!.id },
        data: { jobStatus: 'SENT', sentAt: new Date() },
      })

      await expect(recallOrder(restaurant.id, order.id)).rejects.toThrow(RecallError)

      const attempts = await prisma.notificationAttempt.findMany({ where: { orderId: order.id } })
      expect(attempts).toHaveLength(4)

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should not reset retryCount on prior attempts when recalling', async () => {
      const restaurant = await createRestaurant(`recall-retry-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558302')
      const attempt1 = await createAttempt(order.id)

      await prisma.notificationAttempt.update({
        where: { id: attempt1.id },
        data: { retryCount: 2, jobStatus: 'FAILED', failedAt: new Date() },
      })

      await recallOrder(restaurant.id, order.id)

      const a1 = await prisma.notificationAttempt.findUnique({ where: { id: attempt1.id } })
      expect(a1!.retryCount).toBe(2)

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('RECALL — ineligible', () => {
    it('should reject when order status is not READY', async () => {
      const restaurant = await createRestaurant(`recall-prep-${Date.now()}@ex.com`)
      const order = await prisma.order.create({
        data: {
          restaurantId: restaurant.id,
          displayToken: `recall-${Date.now()}`,
          customerPhone: '+14155558400',
          consentGiven: true,
          consentMethod: 'VERBAL_STAFF_CONFIRMED',
          status: 'PREPARING',
        },
      })
      await createAttempt(order.id)

      await expect(recallOrder(restaurant.id, order.id)).rejects.toThrow('Order must be READY to recall')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should reject when order has an active PENDING attempt', async () => {
      const restaurant = await createRestaurant(`recall-pend-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558401')
      await createAttempt(order.id)

      await expect(recallOrder(restaurant.id, order.id)).rejects.toThrow('Order has an active notification attempt')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should reject when order has an active PROCESSING attempt', async () => {
      const restaurant = await createRestaurant(`recall-proc-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558402')
      const attempt = await createAttempt(order.id)
      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: { jobStatus: 'PROCESSING', claimedAt: new Date() },
      })

      await expect(recallOrder(restaurant.id, order.id)).rejects.toThrow('Order has an active notification attempt')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should reject when max recall count reached', async () => {
      const restaurant = await createRestaurant(`recall-reached-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558403')
      const initial = await createAttempt(order.id)
      await prisma.notificationAttempt.update({
        where: { id: initial.id },
        data: { jobStatus: 'SENT', sentAt: new Date() },
      })

      for (let i = 0; i < 3; i++) {
        await recallOrder(restaurant.id, order.id)
        await prisma.notificationAttempt.update({
          where: {
            id: (await prisma.notificationAttempt.findFirst({ where: { orderId: order.id }, orderBy: { attemptNumber: 'desc' } }))!.id,
          },
          data: { jobStatus: 'SENT', sentAt: new Date() },
        })
      }

      await expect(recallOrder(restaurant.id, order.id)).rejects.toThrow('Maximum recall attempts reached')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })

    it('should reject when order does not exist', async () => {
      const restaurant = await createRestaurant(`recall-nf-${Date.now()}@ex.com`)
      await expect(recallOrder(restaurant.id, 'nonexistent')).rejects.toThrow('Order not found')
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('Concurrent RECALL (FR-037)', () => {
    it('should prevent duplicate attemptNumbers under concurrent RECALL', async () => {
      const restaurant = await createRestaurant(`recall-conc-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558500')
      const initial = await createAttempt(order.id)
      await prisma.notificationAttempt.update({
        where: { id: initial.id },
        data: { jobStatus: 'SENT', sentAt: new Date() },
      })

      const results = await Promise.allSettled([
        recallOrder(restaurant.id, order.id),
        recallOrder(restaurant.id, order.id),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      expect(fulfilled).toHaveLength(1)

      const attempts = await prisma.notificationAttempt.findMany({
        where: { orderId: order.id },
        orderBy: { attemptNumber: 'asc' },
      })
      expect(attempts).toHaveLength(2)
      expect(attempts[0]!.attemptNumber).toBe(1)
      expect(attempts[1]!.attemptNumber).toBe(2)

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })

  describe('Retry vs RECALL distinction', () => {
    it('should never increment attemptNumber during automatic retries and never reset retryCount during RECALL', async () => {
      const restaurant = await createRestaurant(`dist-${Date.now()}@ex.com`)
      const order = await createOrder(restaurant.id, '+14155558600')
      const attempt1 = await createAttempt(order.id)

      setSendFailurePredicate(transientFail())
      await claimAndProcessOne()
      await claimAndProcessOne()

      let a1 = await prisma.notificationAttempt.findUnique({ where: { id: attempt1.id } })
      expect(a1!.attemptNumber).toBe(1)
      expect(a1!.retryCount).toBe(2)
      expect(a1!.jobStatus).toBe('PENDING')

      clearSendFailurePredicate()
      await claimAndProcessOne()
      a1 = await prisma.notificationAttempt.findUnique({ where: { id: attempt1.id } })
      expect(a1!.jobStatus).toBe('SENT')
      expect(a1!.attemptNumber).toBe(1)

      await prisma.notificationAttempt.update({
        where: { id: attempt1.id },
        data: { retryCount: 2 },
      })

      await recallOrder(restaurant.id, order.id)

      a1 = await prisma.notificationAttempt.findUnique({ where: { id: attempt1.id } })
      expect(a1!.retryCount).toBe(2)
      expect(a1!.attemptNumber).toBe(1)

      const a2 = await prisma.notificationAttempt.findFirst({
        where: { orderId: order.id, attemptNumber: 2 },
      })
      expect(a2).not.toBeNull()
      expect(a2!.retryCount).toBe(0)
      expect(a2!.jobStatus).toBe('PENDING')

      await prisma.order.delete({ where: { id: order.id } })
      await prisma.restaurant.delete({ where: { id: restaurant.id } })
    })
  })
})
