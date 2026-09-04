import cors from 'cors'
import express, { type Express } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { env } from './config/env'
import { errorHandler } from './middleware/error'
import { authRouter } from './routes/auth.routes'
import { gameRouter } from './routes/game.routes'
import { leaderboardRouter } from './routes/leaderboard.routes'
import { userRouter } from './routes/user.routes'

export function createApp(): Express {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }))
  app.use(express.json({ limit: '32kb' }))

  app.get('/health', (_req, res) => {
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

  app.use(errorHandler)

  return app
}