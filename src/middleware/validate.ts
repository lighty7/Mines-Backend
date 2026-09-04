import type { RequestHandler } from 'express'
import { z } from 'zod'
import { ApiError } from '../lib/errors'

function formatZodError(error: z.ZodError): string {
  const flattened = error.flatten()
  const fieldEntries = Object.entries(flattened.fieldErrors)
  if (fieldEntries.length > 0) {
    const [field, messages] = fieldEntries[0]
    return messages && messages.length > 0 ? messages[0] : `${field} is invalid`
  }
  if (flattened.formErrors.length > 0) {
    return flattened.formErrors[0]
  }
  return error.errors[0]?.message || 'Validation failed'
}

/**
 * Validates the request body against a Zod schema. Parsed data is stored in
 * `res.locals.body` and downstream handlers should read it from there.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      next(new ApiError(400, formatZodError(result.error)))
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
      next(new ApiError(400, formatZodError(result.error)))
      return
    }
    res.locals.query = result.data
    next()
  }
}