import { Prisma } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { ConflictError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import { AuthService } from '../services/auth.service'

const auth = new AuthService()

export const userRouter = Router()

const updateProfileSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/).optional(),
  address: z.string().trim().max(120).nullable().optional(),
})

userRouter.use(requireAuth)

userRouter.get(
  '/balance',
  asyncHandler(async (req, res) => {
    const user = await auth.me(req.userId!)
    res.json({ balance: user.balance })
  }),
)

userRouter.put(
  '/profile',
  validateBody(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const body = res.locals.body
    try {
      const user = await prisma.user.update({
        where: { id: req.userId! },
        data: {
          ...(body.username !== undefined ? { username: body.username } : {}),
          ...(body.address !== undefined ? { address: body.address } : {}),
        },
      })
      res.json({ user: { id: user.id, username: user.username, email: user.email, address: user.address, balance: user.balance.toNumber() } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Username already in use')
      }
      throw error
    }
  }),
)

const transactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

userRouter.get(
  '/transactions',
  validateQuery(transactionsQuery),
  asyncHandler(async (req, res) => {
    const limit = res.locals.query.limit
    const txs = await prisma.transaction.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        amount: true,
        roundId: true,
        createdAt: true,
      },
    })
    res.json({
      transactions: txs.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount.toNumber(),
        roundId: t.roundId,
        createdAt: t.createdAt.toISOString(),
      })),
    })
  }),
)