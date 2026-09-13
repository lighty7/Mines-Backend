import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import { rouletteService } from '../services/roulette.service'

export const rouletteRouter = Router()

const betSchema = z.object({
  type: z.enum([
    'STRAIGHT',
    'SPLIT',
    'STREET',
    'CORNER',
    'SIX_LINE',
    'COLUMN',
    'DOZEN',
    'RED',
    'BLACK',
    'EVEN',
    'ODD',
    'LOW',
    'HIGH',
  ]),
  numbers: z.array(z.number().int().min(0).max(36)).min(1),
  amount: z.number().positive('amount must be positive').max(100000),
})

const spinSchema = z.object({
  bets: z.array(betSchema).min(1, 'at least one bet required'),
  clientSeed: z.string().trim().max(64).optional(),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
})

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

rouletteRouter.use(requireAuth)

rouletteRouter.post(
  '/spin',
  validateBody(spinSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await rouletteService.spin({
      userId: req.userId!,
      bets: body.bets,
      clientSeed: body.clientSeed,
      idempotencyKey: body.idempotencyKey,
    })
    res.status(200).json(result)
  })
)

rouletteRouter.get(
  '/history',
  validateQuery(historyQuery),
  asyncHandler(async (req, res) => {
    const limit = res.locals.query.limit
    res.json({ rounds: await rouletteService.getHistory(req.userId!, limit) })
  })
)
