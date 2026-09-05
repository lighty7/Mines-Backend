import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { multiplierAt, potentialWin } from '../engine/mines.engine'

export interface AdminStats {
  activePlayersCount: number
  totalUsersCount: number
  bannedUsersCount: number
  mainPot: number
  totalWagered: number
  totalPayout: number
  houseProfit: number
  totalRounds: number
  wonRounds: number
  lostRounds: number
  activeRounds: Array<{
    id: string
    userId: string
    username: string
    bet: number
    mines: number
    boardSize: number
    revealedCount: number
    multiplier: number
    potentialWin: number
    createdAt: string
  }>
}

export class AdminService {
  /**
   * Admin Authentication by Master Secret Key or Admin User Credentials
   */
  async login(input: { key?: string; email?: string; password?: string }) {
    // 1. Master Passcode authentication
    if (input.key && input.key.trim() === env.ADMIN_SECRET_KEY) {
      const token = this.issueAdminToken('system-admin')
      return {
        token,
        admin: {
          id: 'system-admin',
          username: 'System Admin',
          email: 'admin@system.local',
          role: 'ADMIN',
        },
      }
    }

    // 2. Email & password authentication for users with role: ADMIN
    if (input.email && input.password) {
      const email = input.email.trim().toLowerCase()
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user || user.role !== 'ADMIN') {
        throw new UnauthorizedError('Invalid admin credentials')
      }

      if (user.isBanned) {
        throw new ForbiddenError('Admin account is suspended')
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash)
      if (!valid) {
        throw new UnauthorizedError('Invalid admin credentials')
      }

      const token = this.issueAdminToken(user.id)
      return {
        token,
        admin: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: 'ADMIN',
        },
      }
    }

    throw new UnauthorizedError('Please provide a valid Admin Key or Credentials')
  }

  issueAdminToken(adminId: string): string {
    return jwt.sign(
      { sub: adminId, role: 'ADMIN' },
      env.JWT_SECRET,
      { expiresIn: '12h' }
    )
  }

  /**
   * System Overview Metrics & The Main Pot
   */
  async getStats(): Promise<AdminStats> {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)

    const [
      activePlayersCount,
      totalUsersCount,
      bannedUsersCount,
      mainPotAgg,
      wageredAgg,
      payoutAgg,
      totalRounds,
      wonRounds,
      lostRounds,
      activeRoundsRaw,
    ] = await Promise.all([
      // Count of rounds currently active
      prisma.gameRound.count({
        where: { status: 'ACTIVE', createdAt: { gte: fifteenMinutesAgo } },
      }),
      // Total registered players
      prisma.user.count(),
      // Banned players
      prisma.user.count({ where: { isBanned: true } }),
      // The Main Pot: sum of all player balances
      prisma.user.aggregate({ _sum: { balance: true } }),
      // Total volume wagered
      prisma.gameRound.aggregate({ _sum: { bet: true } }),
      // Total payouts won
      prisma.gameRound.aggregate({
        _sum: { payout: true },
        where: { status: 'WON' },
      }),
      // Game counts
      prisma.gameRound.count(),
      prisma.gameRound.count({ where: { status: 'WON' } }),
      prisma.gameRound.count({ where: { status: 'LOST' } }),
      // Recent active games feed
      prisma.gameRound.findMany({
        where: { status: 'ACTIVE' },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { username: true, email: true } },
          reveals: { select: { tileIndex: true, isMine: true } },
        },
      }),
    ])

    const mainPot = mainPotAgg._sum.balance ? Number(mainPotAgg._sum.balance) : 0
    const totalWagered = wageredAgg._sum.bet ? Number(wageredAgg._sum.bet) : 0
    const totalPayout = payoutAgg._sum.payout ? Number(payoutAgg._sum.payout) : 0
    const houseProfit = totalWagered - totalPayout

    const activeRounds = activeRoundsRaw.map((r) => {
      const revealedCount = r.reveals.filter((rev) => !rev.isMine).length
      const mult = multiplierAt(r.mines, revealedCount, r.boardSize)
      const potential = potentialWin(Number(r.bet), r.mines, revealedCount, r.boardSize)

      return {
        id: r.id,
        userId: r.userId,
        username: r.user.username,
        bet: Number(r.bet),
        mines: r.mines,
        boardSize: r.boardSize,
        revealedCount,
        multiplier: mult,
        potentialWin: potential,
        createdAt: r.createdAt.toISOString(),
      }
    })

    return {
      activePlayersCount,
      totalUsersCount,
      bannedUsersCount,
      mainPot,
      totalWagered,
      totalPayout,
      houseProfit,
      totalRounds,
      wonRounds,
      lostRounds,
      activeRounds,
    }
  }

  /**
   * Search & Paginate Users
   */
  async getUsers(params: {
    search?: string
    status?: 'ALL' | 'ACTIVE' | 'BANNED'
    page?: number
    limit?: number
  }) {
    const page = Math.max(1, params.page || 1)
    const limit = Math.min(100, Math.max(1, params.limit || 20))
    const skip = (page - 1) * limit

    const where: Prisma.UserWhereInput = {}

    if (params.status === 'ACTIVE') {
      where.isBanned = false
    } else if (params.status === 'BANNED') {
      where.isBanned = true
    }

    if (params.search?.trim()) {
      const query = params.search.trim()
      where.OR = [
        { username: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
      ]
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          email: true,
          balance: true,
          role: true,
          isBanned: true,
          bannedReason: true,
          createdAt: true,
          _count: {
            select: { games: true },
          },
        },
      }),
    ])

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        balance: Number(u.balance),
        role: u.role,
        isBanned: u.isBanned,
        bannedReason: u.bannedReason,
        gamesCount: u._count.games,
        createdAt: u.createdAt.toISOString(),
      })),
    }
  }

  /**
   * Ban or Unban Player Account
   */
  async setBanStatus(userId: string, isBanned: boolean, bannedReason?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundError('Player not found')

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        isBanned,
        bannedReason: isBanned ? bannedReason || 'Account suspended by administrator' : null,
      },
      select: {
        id: true,
        username: true,
        email: true,
        isBanned: true,
        bannedReason: true,
      },
    })

    return updated
  }

  /**
   * Adjust Player Balance (Credit, Debit, or Absolute Set)
   */
  async adjustBalance(
    userId: string,
    amount: number,
    operation: 'CREDIT' | 'DEBIT' | 'SET',
    reason = 'Admin balance adjustment'
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundError('Player not found')

    const currentBalance = Number(user.balance)
    let newBalance = currentBalance
    let txAmount = amount

    if (operation === 'CREDIT') {
      newBalance = currentBalance + Math.abs(amount)
      txAmount = Math.abs(amount)
    } else if (operation === 'DEBIT') {
      newBalance = Math.max(0, currentBalance - Math.abs(amount))
      txAmount = -Math.abs(amount)
    } else if (operation === 'SET') {
      newBalance = Math.max(0, amount)
      txAmount = newBalance - currentBalance
    }

    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { balance: newBalance },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: 'ADMIN_ADJUST',
          amount: new Prisma.Decimal(txAmount),
          idempotencyKey: `admin-adj-${userId}-${Date.now()}`,
        },
      }),
    ])

    return {
      userId: updatedUser.id,
      username: updatedUser.username,
      previousBalance: currentBalance,
      balance: Number(updatedUser.balance),
      reason,
    }
  }

  /**
   * Delete Player Account
   */
  async deleteUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundError('Player not found')

    await prisma.user.delete({ where: { id: userId } })
    return { success: true, message: `Player ${user.username} deleted successfully` }
  }
}

export const adminService = new AdminService()
