import { Router } from 'express'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'

export const leaderboardRouter = Router()

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

leaderboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = Number.parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10)
    const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed : DEFAULT_LIMIT, 1), MAX_LIMIT)

    const rows = await prisma.$queryRaw<
      { id: string; username: string; net: string }[]
    >`
      SELECT
        u."id" AS "id",
        u."username" AS "username",
        COALESCE(SUM(
          CASE
            WHEN t."type" = 'WIN' THEN t."amount"
            WHEN t."type" = 'BET' THEN -t."amount"
            ELSE 0
          END
        ), 0) AS "net"
      FROM "User" u
      LEFT JOIN "Transaction" t ON t."userId" = u."id"
      GROUP BY u."id", u."username"
      ORDER BY "net" DESC
      LIMIT ${limit}
    `

    res.json({
      leaderboard: rows.map((r) => ({ id: r.id, username: r.username, net: Number(r.net) })),
    })
  }),
)