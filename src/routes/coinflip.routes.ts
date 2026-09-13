import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import { coinFlipService } from '../services/coinflip.service'

export const coinFlipRouter = Router()

const startSchema = z.object({
  bet: z.number().positive('bet must be positive').max(100000),
  clientSeed: z.string().trim().max(64).optional(),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
})

const flipSchema = z.object({
  roundId: z.string().min(1).max(64),
  guess: z.enum(['HEADS', 'TAILS']),
})

const cashoutSchema = z.object({
  roundId: z.string().min(1).max(64),
})

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

coinFlipRouter.use(requireAuth)

coinFlipRouter.post(
  '/start',
  validateBody(startSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await coinFlipService.startRound({
      userId: req.userId!,
      bet: body.bet,
      clientSeed: body.clientSeed,
      idempotencyKey: body.idempotencyKey,
    })
    res.status(201).json(result)
  })
)

coinFlipRouter.post(
  '/flip',
  validateBody(flipSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await coinFlipService.flip({
      userId: req.userId!,
      roundId: body.roundId,
      guess: body.guess,
    })
    res.json(result)
  })
)

coinFlipRouter.post(
  '/cashout',
  validateBody(cashoutSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await coinFlipService.cashout(req.userId!, body.roundId)
    res.json(result)
  })
)

coinFlipRouter.get(
  '/history',
  validateQuery(historyQuery),
  asyncHandler(async (req, res) => {
    const limit = res.locals.query.limit
    res.json({ rounds: await coinFlipService.getHistory(req.userId!, limit) })
  })
)
