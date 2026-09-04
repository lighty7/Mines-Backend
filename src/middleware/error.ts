import { Prisma } from '@prisma/client'
import type { ErrorRequestHandler } from 'express'
import { ApiError } from '../lib/errors'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: err.message })
    return
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Duplicate value for a unique field' })
      return
    }
    res.status(500).json({ error: 'Database error' })
    return
  }

  if (err instanceof SyntaxError) {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  // eslint-disable-next-line no-console
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}