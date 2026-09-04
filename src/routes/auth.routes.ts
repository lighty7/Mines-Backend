import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/async-handler'
import { requireAuth } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { AuthService } from '../services/auth.service'

const auth = new AuthService()

export const authRouter = Router()

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'username must be at least 3 characters')
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'username may only contain letters, digits and underscores'),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(6, 'password must be at least 6 characters').max(72),
  address: z.string().trim().max(120).optional(),
})

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(72),
})

const sendOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  reason: z.string().trim().max(64).optional(),
})

const verifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  code: z.string().trim().length(6, 'OTP must be exactly 6 digits'),
})

authRouter.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (_req, res) => {
    const result = await auth.register(res.locals.body)
    res.status(201).json(result)
  }),
)

authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (_req, res) => {
    res.json(await auth.login(res.locals.body))
  }),
)

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: await auth.me(req.userId!) })
  }),
)

authRouter.post(
  '/send-otp',
  validateBody(sendOtpSchema),
  asyncHandler(async (_req, res) => {
    const { email, reason } = res.locals.body
    res.json(await auth.sendOtp(email, reason))
  }),
)

authRouter.post(
  '/verify-otp',
  validateBody(verifyOtpSchema),
  asyncHandler(async (_req, res) => {
    const { email, code } = res.locals.body
    const valid = auth.verifyOtp(email, code)
    if (!valid) {
      res.status(400).json({ valid: false, error: 'Invalid or expired OTP code' })
      return
    }
    res.json({ valid: true, message: 'OTP verified successfully' })
  }),
)