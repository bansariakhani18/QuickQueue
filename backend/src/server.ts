import express from 'express'

const app = express()
const port = Number.parseInt(process.env.BACKEND_PORT ?? '3000', 10)

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' })
})

app.listen(port, () => {
  console.info(`QuickQueue backend listening on port ${port}`)
})
