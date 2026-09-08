import express from 'express'
import { sessionMiddleware, authRouter } from './auth.js'

const app = express()

app.use(express.json())
app.use(sessionMiddleware)

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' })
})

app.use('/auth', authRouter)

export { app }
