export interface NotificationPayload {
  orderId: string
  restaurantId: string
  customerPhone: string
}

export interface NotificationSender {
  send(payload: NotificationPayload): Promise<void>
}

class MockNotificationSender implements NotificationSender {
  async send(_payload: NotificationPayload): Promise<void> {
    return
  }
}

let sender: NotificationSender = new MockNotificationSender()

export function setNotificationSender(s: NotificationSender): void {
  sender = s
}

export function getNotificationSender(): NotificationSender {
  return sender
}
