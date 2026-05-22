import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)

// Allow requests from Vite dev server and production web origin
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:4173',
      ...(process.env.WEB_ORIGIN ? [process.env.WEB_ORIGIN] : []),
    ],
  }),
)
app.use(express.json())

app.use('/api/auth', authRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`\n🚀 AIOS server running on http://localhost:${PORT}\n`)
})
