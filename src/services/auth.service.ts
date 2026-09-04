import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Prisma } from '@prisma/client'
import { env } from '../config/env'
import { ConflictError, NotFoundError, UnauthorizedError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { emailService } from './email.service'

interface OtpEntry {
  code: string
  expiresAt: number
}

const otpStore = new Map<string, OtpEntry>()

export interface RegisterInput {
  username: string
  email: string
  password: string
  address?: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface JwtPayload {
  sub: string
}

export class AuthService {
  async register(input: RegisterInput) {
    const username = input.username.trim()
    const email = input.email.trim().toLowerCase()
    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS)

    try {
      const user = await prisma.user.create({
        data: { username, email, passwordHash, address: input.address?.trim() || null },
        select: { id: true, username: true, email: true, balance: true, address: true, createdAt: true },
      })
      // Send confirmation welcome email asynchronously without blocking registration response
      emailService.sendWelcomeEmail(user.email, user.username).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[AuthService] Welcome email error:', err)
      })
      return { user, token: this.issueToken(user.id) }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Username or email already in use')
      }
      throw error
    }
  }

  async sendOtp(email: string, reason = 'verification'): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase()
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    otpStore.set(normalizedEmail, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    })
    await emailService.sendOtpEmail(normalizedEmail, code, reason)
    return { message: 'OTP sent successfully' }
  }

  verifyOtp(email: string, code: string): boolean {
    const normalizedEmail = email.trim().toLowerCase()
    const entry = otpStore.get(normalizedEmail)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      otpStore.delete(normalizedEmail)
      return false
    }
    const match = entry.code === code.trim()
    if (match) {
      otpStore.delete(normalizedEmail)
    }
    return match
  }

  async login(input: LoginInput) {
    const email = input.email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      throw new UnauthorizedError('Invalid email or password')
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash)
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password')
    }

    return { user: this.toPublicUser(user), token: this.issueToken(user.id) }
  }

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundError('User not found')
    return this.toPublicUser(user)
  }

  issueToken(userId: string): string {
    return jwt.sign({ sub: userId } satisfies JwtPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    } as jwt.SignOptions)
  }

  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET) as JwtPayload
    } catch {
      throw new UnauthorizedError('Invalid or expired token')
    }
  }

  private toPublicUser(user: {
    id: string
    username: string
    email: string
    balance: Prisma.Decimal
    address: string | null
    createdAt: Date
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      balance: user.balance.toNumber(),
      address: user.address,
      createdAt: user.createdAt,
    }
  }
}