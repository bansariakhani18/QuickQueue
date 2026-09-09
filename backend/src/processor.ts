import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export interface NotificationPayload {
  orderId: string
  restaurantId: string
  customerPhone: string
}

export type FailureType = 'transient' | 'permanent'

export interface NotificationSender {
  send(payload: NotificationPayload): Promise<void>
}

let failPredicate: ((payload: NotificationPayload) => FailureType | null) | null = null

export function setNotificationSender(_s: NotificationSender): void {
  // Phase 12 will replace this with real WhatsApp integration
}

export function getNotificationSender(): NotificationSender {
  return {
    async send(payload: NotificationPayload): Promise<void> {
      const result = failPredicate?.(payload)
      if (result === 'transient') {
        throw new Error('Mock transient failure')
      }
      if (result === 'permanent') {
        throw new Error('Mock permanent failure')
      }
    },
  }
}

export function setSendFailurePredicate(fn: (payload: NotificationPayload) => FailureType | null): void {
  failPredicate = fn
}

export function clearSendFailurePredicate(): void {
  failPredicate = null
}

const MAX_RETRIES = 3

function getRetryBackoffMs(): number {
  const envMs = parseInt(process.env.RETRY_BACKOFF_MS ?? '', 10)
  return Number.isFinite(envMs) ? envMs : 30_000
}

export async function claimAndProcessOne(): Promise<boolean> {
  const claimed = await claimOne()
  if (!claimed) return false

  await processAttempt(claimed.id)
  return true
}

async function claimOne(): Promise<{ id: string } | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT na.id
    FROM notification_attempts na
    JOIN orders o ON o.id = na.order_id
    JOIN restaurants r ON r.id = o.restaurant_id
    WHERE na.job_status = 'PENDING'
      AND r.status != 'DEACTIVATED'
      AND (na.next_retry_at IS NULL OR na.next_retry_at <= NOW())
    ORDER BY na.created_at ASC
    LIMIT 1
    FOR UPDATE OF na SKIP LOCKED
  `

  if (rows.length === 0) return null

  const claimed = rows[0]!
  const now = new Date()

  await prisma.notificationAttempt.update({
    where: { id: claimed.id },
    data: {
      jobStatus: 'PROCESSING',
      claimedAt: now,
    },
  })

  return claimed
}

async function processAttempt(attemptId: string): Promise<void> {
  const attempt = await prisma.notificationAttempt.findUnique({
    where: { id: attemptId },
    include: { order: true },
  })

  if (!attempt || attempt.jobStatus !== 'PROCESSING') return

  const payload: NotificationPayload = {
    orderId: attempt.orderId,
    restaurantId: attempt.order.restaurantId,
    customerPhone: attempt.order.customerPhone ?? '',
  }

  try {
    await getNotificationSender().send(payload)
    await prisma.notificationAttempt.update({
      where: { id: attemptId },
      data: {
        jobStatus: 'SENT',
        sentAt: new Date(),
      },
    })
  } catch (err) {
    const isTransient = err instanceof Error && err.message.includes('transient')

    if (isTransient && attempt.retryCount < MAX_RETRIES) {
      const nextRetryAt = new Date(Date.now() + getRetryBackoffMs())
      await prisma.notificationAttempt.update({
        where: { id: attemptId },
        data: {
          retryCount: { increment: 1 },
          jobStatus: 'PENDING',
          claimedAt: null,
          nextRetryAt,
        },
      })
    } else {
      await prisma.notificationAttempt.update({
        where: { id: attemptId },
        data: {
          jobStatus: 'FAILED',
          failedAt: new Date(),
        },
      })
    }
  }
}

export async function recoverStuckJobs(
  thresholdMs: number = 2 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMs)

  const result = await prisma.notificationAttempt.updateMany({
    where: {
      jobStatus: 'PROCESSING',
      claimedAt: { lt: cutoff },
    },
    data: {
      jobStatus: 'PENDING',
      claimedAt: null,
    },
  })

  return result.count
}

const DEFAULT_RETENTION_HOURS = 72

function getRetentionHours(): number {
  const envHours = parseInt(process.env.RETENTION_HOURS ?? '', 10)
  return Number.isFinite(envHours) ? envHours : DEFAULT_RETENTION_HOURS
}

export async function scrubExpiredPhones(
  retentionHours?: number,
): Promise<number> {
  const hours = retentionHours ?? getRetentionHours()
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

  const result = await prisma.order.updateMany({
    where: {
      status: { in: ['COLLECTED', 'CANCELLED'] },
      terminalAt: { not: null, lt: cutoff },
      customerPhone: { not: null },
    },
    data: {
      customerPhone: null,
      phoneScrubbedAt: new Date(),
    },
  })

  return result.count
}

export async function recallOrder(
  restaurantId: string,
  orderId: string,
): Promise<{ attemptNumber: number }> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; status: string }[]
    >`SELECT id, status FROM orders WHERE id = ${orderId} AND restaurant_id = ${restaurantId} FOR UPDATE`

    if (rows.length === 0) {
      throw new RecallError('Order not found')
    }

    const order = rows[0]!
    if (order.status !== 'READY') {
      throw new RecallError('Order must be READY to recall')
    }

    const activeAttempt = await tx.notificationAttempt.findFirst({
      where: {
        orderId,
        jobStatus: { in: ['PENDING', 'PROCESSING'] },
      },
    })

    if (activeAttempt) {
      throw new RecallError('Order has an active notification attempt')
    }

    const recallAttempts = await tx.notificationAttempt.count({
      where: { orderId },
    })

    if (recallAttempts >= 4) {
      throw new RecallError('Maximum recall attempts reached')
    }

    const maxAttempt = await tx.notificationAttempt.aggregate({
      where: { orderId },
      _max: { attemptNumber: true },
    })

    const nextAttemptNumber = (maxAttempt._max.attemptNumber ?? 0) + 1

    const attempt = await tx.notificationAttempt.create({
      data: {
        orderId,
        attemptNumber: nextAttemptNumber,
        channel: 'WHATSAPP',
        jobStatus: 'PENDING',
      },
    })

    return { attemptNumber: attempt.attemptNumber }
  })
}

export class RecallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecallError'
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null
let scrubIntervalHandle: ReturnType<typeof setInterval> | null = null

export function startProcessor(intervalMs?: number): void {
  if (intervalHandle) return

  const envMs = parseInt(process.env.PROCESSOR_INTERVAL_MS ?? '', 10)
  const ms = intervalMs ?? (Number.isFinite(envMs) ? envMs : 5000)

  intervalHandle = setInterval(async () => {
    try {
      await claimAndProcessOne()
    } catch {
      // claim/processing error — do not crash, do not skip recovery
    }
    try {
      await recoverStuckJobs()
    } catch {
      // recovery error — do not crash
    }
  }, ms)

  if (intervalHandle.unref) {
    intervalHandle.unref()
  }

  if (!scrubIntervalHandle) {
    const scrubEnvMs = parseInt(process.env.SCRUB_INTERVAL_MS ?? '', 10)
    const scrubMs = Number.isFinite(scrubEnvMs) ? scrubEnvMs : 60 * 60 * 1000

    scrubIntervalHandle = setInterval(async () => {
      try {
        await scrubExpiredPhones()
      } catch {
        // scrub error — do not crash
      }
    }, scrubMs)

    if (scrubIntervalHandle.unref) {
      scrubIntervalHandle.unref()
    }
  }
}

export function stopProcessor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  if (scrubIntervalHandle) {
    clearInterval(scrubIntervalHandle)
    scrubIntervalHandle = null
  }
}
