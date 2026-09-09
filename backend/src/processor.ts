import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export interface NotificationPayload {
  orderId: string
  restaurantId: string
  customerPhone: string
}

export interface NotificationSender {
  send(payload: NotificationPayload): Promise<void>
}

let failPredicate: ((payload: NotificationPayload) => boolean) | null = null

export function setNotificationSender(_s: NotificationSender): void {
  // Phase 12 will replace this with real WhatsApp integration
}

export function getNotificationSender(): NotificationSender {
  return {
    async send(payload: NotificationPayload): Promise<void> {
      if (failPredicate?.(payload)) {
        throw new Error('Mock notification send failure')
      }
    },
  }
}

export function setSendFailurePredicate(fn: (payload: NotificationPayload) => boolean): void {
  failPredicate = fn
}

export function clearSendFailurePredicate(): void {
  failPredicate = null
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
  } catch {
    await prisma.notificationAttempt.update({
      where: { id: attemptId },
      data: {
        jobStatus: 'FAILED',
        failedAt: new Date(),
      },
    })
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

let intervalHandle: ReturnType<typeof setInterval> | null = null

export function startProcessor(intervalMs?: number): void {
  if (intervalHandle) return

  const envMs = parseInt(process.env.PROCESSOR_INTERVAL_MS ?? '', 10)
  const ms = intervalMs ?? (Number.isFinite(envMs) ? envMs : 5000)

  intervalHandle = setInterval(async () => {
    try {
      await claimAndProcessOne()
      await recoverStuckJobs()
    } catch {
      // processor tick error — do not crash
    }
  }, ms)

  if (intervalHandle.unref) {
    intervalHandle.unref()
  }
}

export function stopProcessor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
