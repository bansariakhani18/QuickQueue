export interface EmailSender {
  sendPasswordReset(to: string, resetLink: string): Promise<void>
}

class ConsoleEmailSender implements EmailSender {
  async sendPasswordReset(to: string, resetLink: string): Promise<void> {
    console.info(`[DEV EMAIL] Password reset for ${to}: ${resetLink}`)
  }
}

let sender: EmailSender = new ConsoleEmailSender()

export function setEmailSender(s: EmailSender): void {
  sender = s
}

export function getEmailSender(): EmailSender {
  return sender
}
