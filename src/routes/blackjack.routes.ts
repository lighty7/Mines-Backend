import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import { blackjackService } from '../services/blackjack.service'

export const blackjackRouter = Router()

const dealSchema = z.object({
  bet: z.number().positive('bet must be positive').max(100000),
  clientSeed: z.string().trim().max(64).optional(),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
})

const actionSchema = z.object({
  roundId: z.string().min(1).max(64),
})

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

blackjackRouter.use(requireAuth)

blackjackRouter.post(
  '/deal',
  validateBody(dealSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await blackjackService.deal({
      userId: req.userId!,
      bet: body.bet,
      clientSeed: body.clientSeed,
      idempotencyKey: body.idempotencyKey,
    })
    res.status(201).json(result)
  })
)

blackjackRouter.post(
  '/hit',
  validateBody(actionSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await blackjackService.hit(req.userId!, body.roundId)
    res.json(result)
  })
)

blackjackRouter.post(
  '/stand',
  validateBody(actionSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await blackjackService.stand(req.userId!, body.roundId)
    res.json(result)
  })
)

blackjackRouter.post(
  '/double',
  validateBody(actionSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await blackjackService.double(req.userId!, body.roundId)
    res.json(result)
  })
)

blackjackRouter.get(
  '/history',
  validateQuery(historyQuery),
  asyncHandler(async (req, res) => {
    const limit = res.locals.query.limit
    res.json({ rounds: await blackjackService.getHistory(req.userId!, limit) })
  })
)
