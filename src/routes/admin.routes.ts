import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async-handler'
import { requireAdmin } from '../middleware/admin'
import { validateBody, validateQuery } from '../middleware/validate'
import { adminService } from '../services/admin.service'

export const adminRouter = Router()

const loginSchema = z.object({
  key: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().optional(),
}).refine((data) => data.key || (data.email && data.password), {
  message: 'Either admin key or email and password must be provided',
})

const usersQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(['ALL', 'ACTIVE', 'BANNED']).optional().default('ALL'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

const banSchema = z.object({
  isBanned: z.boolean(),
  bannedReason: z.string().max(200).optional(),
})

const balanceSchema = z.object({
  amount: z.number().positive('amount must be positive'),
  operation: z.enum(['CREDIT', 'DEBIT', 'SET']),
  reason: z.string().max(200).optional(),
})

// 1. Admin Login
adminRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await adminService.login(req.body)
    res.json(result)
  })
)

// 2. Get System Stats & Main Pot
adminRouter.get(
  '/stats',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const stats = await adminService.getStats()
    res.json(stats)
  })
)

// 3. Search & List Players
adminRouter.get(
  '/users',
  requireAdmin,
  validateQuery(usersQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await adminService.getUsers(req.query as any)
    res.json(result)
  })
)

// 4. Ban / Unban Player
adminRouter.patch(
  '/users/:id/ban',
  requireAdmin,
  validateBody(banSchema),
  asyncHandler(async (req, res) => {
    const result = await adminService.setBanStatus(
      req.params.id,
      req.body.isBanned,
      req.body.bannedReason
    )
    res.json(result)
  })
)

// 5. Adjust Player Balance
adminRouter.patch(
  '/users/:id/balance',
  requireAdmin,
  validateBody(balanceSchema),
  asyncHandler(async (req, res) => {
    const result = await adminService.adjustBalance(
      req.params.id,
      req.body.amount,
      req.body.operation,
      req.body.reason
    )
    res.json(result)
  })
)

// 6. Delete Player Account
adminRouter.delete(
  '/users/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await adminService.deleteUser(req.params.id)
    res.json(result)
  })
)
