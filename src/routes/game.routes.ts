import { Router } from 'express'
import { z } from 'zod'
import { maxMinesForBoard } from '../engine/mines.engine'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import { game } from '../services/game.service'

export const gameRouter = Router()

const startSchema = z
  .object({
    bet: z.number().positive('bet must be positive').max(1e12),
    mines: z.number().int().min(1, 'mines must be at least 1'),
    boardSize: z.number().int().min(4).max(6).default(5),
    clientSeed: z.string().trim().max(64).optional(),
    idempotencyKey: z.string().trim().min(8).max(64).optional(),
  })
  .superRefine((val, ctx) => {
    const max = maxMinesForBoard(val.boardSize)
    if (val.mines > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mines'],
        message: `mines must be at most ${max} for a ${val.boardSize}x${val.boardSize} board`,
      })
    }
  })

const revealSchema = z.object({
  roundId: z.string().min(1).max(64),
  tileIndex: z.number().int().min(0, 'tileIndex must be >= 0'),
})

const cashoutSchema = z.object({
  roundId: z.string().min(1).max(64),
})

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

gameRouter.use(requireAuth)

gameRouter.post(
  '/start',
  validateBody(startSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    const result = await game.startRound({
      userId: req.userId!,
      bet: body.bet,
      mines: body.mines,
      boardSize: body.boardSize,
      clientSeed: body.clientSeed,
      idempotencyKey: body.idempotencyKey,
    })
    res.status(201).json(result)
  }),
)

gameRouter.post(
  '/reveal',
  validateBody(revealSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    res.json(await game.revealTile({ userId: req.userId!, roundId: body.roundId, tileIndex: body.tileIndex }))
  }),
)

gameRouter.post(
  '/cashout',
  validateBody(cashoutSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    res.json(await game.cashOut({ userId: req.userId!, roundId: body.roundId }))
  }),
)

gameRouter.get(
  '/history',
  validateQuery(historyQuery),
  asyncHandler(async (req, res) => {
    const limit = res.locals.query.limit
    res.json({ rounds: await game.listHistory(req.userId!, limit) })
  }),
)