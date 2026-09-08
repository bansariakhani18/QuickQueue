import { app } from './app.js'

const port = Number.parseInt(process.env.BACKEND_PORT ?? '3000', 10)

app.listen(port, () => {
  console.info(`QuickQueue backend listening on port ${port}`)
})
