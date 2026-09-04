import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'
import { UnauthorizedError } from '../lib/errors'
import { AuthService } from '../services/auth.service'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

const authService = new AuthService()

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError())
    return
  }

  const token = header.slice('Bearer '.length).trim()
  const payload = authService.verifyToken(token)
  req.userId = payload.sub
  next()
}