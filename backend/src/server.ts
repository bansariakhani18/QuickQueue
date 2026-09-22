import { app } from './app.js'
import { createRealWhatsAppSender, setNotificationSender } from './processor.js'

const port = Number.parseInt(process.env.BACKEND_PORT ?? '3000', 10)

const realSender = createRealWhatsAppSender()
if (realSender) {
  setNotificationSender(realSender)
}

app.listen(port, () => {
  console.info(`QuickQueue backend listening on port ${port}`)
})
