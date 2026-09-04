import type { NextFunction, Request, RequestHandler, Response } from 'express'

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

/** Express 4 does not catch async rejections — this wrapper forwards them to the error handler. */
export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}