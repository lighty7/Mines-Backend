import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import { slotsService } from '../services/slots.service'
import { TOTAL_PAYLINES } from '../engine/slots.engine'

export const slotsRouter = Router()

const spinSchema = z.object({
  betPerLine: z.number().positive('betPerLine must be positive').max(100000),
  lines: z.number().int().min(1).max(TOTAL_PAYLINES).default(TOTAL_PAYLINES),
  clientSeed: z.string().trim().max(64).optional(),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
})

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

// Public paytable info
slotsRouter.get(
  '/paytable',
  asyncHandler(async (_req, res) => {
    res.json(await slotsService.getPaytable())
  })
)

// Authenticated spin
slotsRouter.post(
  '/spin',
  requireAuth,
  validateBody(spinSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await slotsService.spin({
      userId: req.userId!,
      betPerLine: body.betPerLine,
      lines: body.lines,
      clientSeed: body.clientSeed,
      idempotencyKey: body.idempotencyKey,
    })
    res.status(200).json(result)
  })
)

// Authenticated history
slotsRouter.get(
  '/history',
  requireAuth,
  validateQuery(historyQuery),
  asyncHandler(async (req, res) => {
    const limit = res.locals.query.limit
    res.json({ rounds: await slotsService.getHistory(req.userId!, limit) })
  })
)
