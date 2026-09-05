import cors from 'cors'
import express, { type Express } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { env } from './config/env'
import { errorHandler } from './middleware/error'
import { adminRouter } from './routes/admin.routes'
import { authRouter } from './routes/auth.routes'
import { gameRouter } from './routes/game.routes'
import { leaderboardRouter } from './routes/leaderboard.routes'
import { userRouter } from './routes/user.routes'

export function createApp(): Express {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  const allowedOrigins = (Array.isArray(env.CORS_ORIGINS) ? env.CORS_ORIGINS : [env.CORS_ORIGINS]).map((o) =>
    o.replace(/\/+$/, '').toLowerCase()
  )

  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      const normalized = origin.replace(/\/+$/, '').toLowerCase()
      if (
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes(normalized) ||
        allowedOrigins.includes('*')
      ) {
        return callback(null, true)
      }
      if (
        normalized.endsWith('.vercel.app') ||
        normalized.endsWith('.duckdns.org') ||
        normalized.includes('duckdns.org') ||
        normalized.includes('localhost') ||
        normalized.includes('127.0.0.1')
      ) {
        return callback(null, true)
      }
      return callback(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-idempotency-key', 'x-admin-key'],
  }

  app.use(cors(corsOptions))
  app.options('*', cors(corsOptions))
  app.use(express.json({ limit: '32kb' }))

  app.get(['/health', '/api/health'], (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Auth endpoints are the primary brute-force surface: strict per-IP budget.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })
  app.use('/api/auth', authLimiter, authRouter)

  // Game actions move money: generous but bounded so abuse can't starve others.
  const gameLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })
  app.use('/api/game', gameLimiter, gameRouter)

  app.use('/api/user', userRouter)
  app.use('/api/leaderboard', leaderboardRouter)
  app.use('/api/admin', adminRouter)

  app.use(errorHandler)

  return app
}