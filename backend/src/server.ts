import { app } from './app.js'
import { createRestaurantAwareWhatsAppSender, setNotificationSender } from './processor.js'

const port = Number.parseInt(process.env.BACKEND_PORT ?? '3000', 10)

setNotificationSender(createRestaurantAwareWhatsAppSender())

app.listen(port, () => {
  console.info(`QuickQueue backend listening on port ${port}`)
})