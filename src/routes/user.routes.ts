import { Prisma } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { ConflictError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
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