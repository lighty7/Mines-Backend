import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { ForbiddenError, UnauthorizedError } from '../lib/errors'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      isAdmin?: boolean
    }
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  // 1. Direct Secret Header bypass
  const adminKey = req.headers['x-admin-key'] as string | undefined
  if (adminKey && adminKey.trim() === env.ADMIN_SECRET_KEY) {
    req.isAdmin = true
    return next()
  }

  // 2. Bearer Token validation
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Admin authorization required'))
  }

  const token = header.slice('Bearer '.length).trim()
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; role?: string }
    if (payload.role !== 'ADMIN') {
      return next(new ForbiddenError('Administrator privileges required'))
    }
    req.userId = payload.sub
    req.isAdmin = true
    next()
  } catch {
    next(new UnauthorizedError('Invalid or expired admin token'))
  }
}
