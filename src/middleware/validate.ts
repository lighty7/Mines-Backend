import type { RequestHandler } from 'express'
import { z } from 'zod'
import { ApiError } from '../lib/errors'

/**
 * Validates the request body against a Zod schema. Parsed data is stored in
 * `res.locals.body` and downstream handlers should read it from there.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      next(new ApiError(400, 'Invalid request body: ' + JSON.stringify(result.error.flatten())))
      return
    }
    res.locals.body = result.data
    next()
  }
}

/** Validates `req.query` against a Zod schema. Parsed data is stored in `res.locals.query`. */
export function validateQuery<T extends z.ZodTypeAny>(schema: T): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      next(new ApiError(400, 'Invalid query: ' + JSON.stringify(result.error.flatten())))
      return
    }
    res.locals.query = result.data
    next()
  }
}