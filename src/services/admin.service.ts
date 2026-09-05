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

export interface AdminDashboardData {
  overview: {
    mainPot: number
    totalWagered: number
    totalPayout: number
    houseProfit: number
    todayWagered: number
    todayProfit: number
    realizedRtp: number
    totalRounds: number
    wonRounds: number
    lostRounds: number
    winRate: number
    averageBet: number
    activePlayersCount: number
    totalUsersCount: number
    bannedUsersCount: number
    newUsersLast7Days: number
  }
  highestWin: {
    amount: number
    multiplier: number
    username: string
    createdAt: string
  } | null
  gridDistribution: {
    '4x4': number
    '5x5': number
    '6x6': number
  }
  chart7Days: Array<{
    date: string
    wagered: number
    payout: number
    profit: number
    rounds: number
  }>
  topWinners: Array<{
    id: string
    username: string
    totalProfit: number
    balance: number
  }>
  recentActivity: Array<{
    id: string
    type: string
    username: string
    amount: number
    createdAt: string
  }>
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

    // Batch 1: User counts & Main Pot
    const [totalUsersCount, bannedUsersCount, mainPotAgg] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isBanned: true } }),
      prisma.user.aggregate({ _sum: { balance: true } }),
    ])

    // Batch 2: Round volume aggregates
    const [wageredAgg, payoutAgg] = await Promise.all([
      prisma.gameRound.aggregate({ _sum: { bet: true } }),
      prisma.gameRound.aggregate({
        _sum: { payout: true },
        where: { status: 'WON' },
      }),
    ])

    // Batch 3: Round outcome counts
    const [totalRounds, wonRounds, lostRounds] = await Promise.all([
      prisma.gameRound.count(),
      prisma.gameRound.count({ where: { status: 'WON' } }),
      prisma.gameRound.count({ where: { status: 'LOST' } }),
    ])

    // Batch 4: Active player count & active rounds feed
    const [activePlayersCount, activeRoundsRaw] = await Promise.all([
      prisma.gameRound.count({
        where: { status: 'ACTIVE', createdAt: { gte: fifteenMinutesAgo } },
      }),
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
   * Executive Analytics Dashboard Data
   */
  async getDashboardAnalytics(): Promise<AdminDashboardData> {
    const now = Date.now()
    const fifteenMinutesAgo = new Date(now - 15 * 60 * 1000)
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)

    // Batch 1: User counts & Main Pot
    const [activePlayersCount, totalUsersCount, bannedUsersCount, newUsers7d, mainPotAgg] =
      await Promise.all([
        prisma.gameRound.count({
          where: { status: 'ACTIVE', createdAt: { gte: fifteenMinutesAgo } },
        }),
        prisma.user.count(),
        prisma.user.count({ where: { isBanned: true } }),
        prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        prisma.user.aggregate({ _sum: { balance: true } }),
      ])

    // Batch 2: Volume aggregates (all-time & 24h)
    const [wageredAgg, payoutAgg, todayWageredAgg, todayPayoutAgg] = await Promise.all([
      prisma.gameRound.aggregate({ _sum: { bet: true } }),
      prisma.gameRound.aggregate({ where: { status: 'WON' }, _sum: { payout: true } }),
      prisma.gameRound.aggregate({
        where: { createdAt: { gte: twentyFourHoursAgo } },
        _sum: { bet: true },
      }),
      prisma.gameRound.aggregate({
        where: { createdAt: { gte: twentyFourHoursAgo }, status: 'WON' },
        _sum: { payout: true },
      }),
    ])

    // Batch 3: Round outcome counts & grid popularity
    const [totalRounds, wonRounds, lostRounds, gridGroups] = await Promise.all([
      prisma.gameRound.count(),
      prisma.gameRound.count({ where: { status: 'WON' } }),
      prisma.gameRound.count({ where: { status: 'LOST' } }),
      prisma.gameRound.groupBy({
        by: ['boardSize'],
        _count: { _all: true },
      }),
    ])

    // Batch 4: Highlights & leaderboards
    const [highestWinRaw, topUsersRaw] = await Promise.all([
      prisma.gameRound.findFirst({
        where: { status: 'WON' },
        orderBy: { payout: 'desc' },
        include: { user: { select: { username: true } } },
      }),
      prisma.user.findMany({
        take: 5,
        orderBy: { balance: 'desc' },
        select: { id: true, username: true, balance: true },
      }),
    ])

    // Batch 5: 7-day rounds, recent transactions & active rounds
    const [last7DaysRounds, recentTxRaw, activeRoundsRaw] = await Promise.all([
      prisma.gameRound.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { bet: true, payout: true, status: true, createdAt: true },
      }),
      prisma.transaction.findMany({
        take: 15,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true } } },
      }),
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

    const todayWagered = todayWageredAgg._sum.bet ? Number(todayWageredAgg._sum.bet) : 0
    const todayPayout = todayPayoutAgg._sum.payout ? Number(todayPayoutAgg._sum.payout) : 0
    const todayProfit = todayWagered - todayPayout

    const realizedRtp = totalWagered > 0 ? (totalPayout / totalWagered) * 100 : 99.0
    const winRate = totalRounds > 0 ? (wonRounds / totalRounds) * 100 : 0
    const averageBet = totalRounds > 0 ? totalWagered / totalRounds : 0

    // Grid distribution
    const gridMap: Record<string, number> = { '4x4': 0, '5x5': 0, '6x6': 0 }
    for (const g of gridGroups) {
      gridMap[`${g.boardSize}x${g.boardSize}`] = g._count._all
    }

    // 7-day chart buckets
    const daysMap: Record<string, { wagered: number; payout: number; profit: number; rounds: number }> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      daysMap[key] = { wagered: 0, payout: 0, profit: 0, rounds: 0 }
    }

    for (const r of last7DaysRounds) {
      const key = r.createdAt.toISOString().slice(0, 10)
      if (daysMap[key]) {
        const bet = Number(r.bet)
        const payout = r.payout ? Number(r.payout) : 0
        daysMap[key].wagered += bet
        daysMap[key].payout += payout
        daysMap[key].profit += bet - payout
        daysMap[key].rounds += 1
      }
    }

    const chart7Days = Object.entries(daysMap).map(([date, d]) => ({
      date,
      wagered: Math.round(d.wagered * 100) / 100,
      payout: Math.round(d.payout * 100) / 100,
      profit: Math.round(d.profit * 100) / 100,
      rounds: d.rounds,
    }))

    const highestWin =
      highestWinRaw && highestWinRaw.payout
        ? {
            amount: Number(highestWinRaw.payout),
            multiplier: Number(highestWinRaw.multiplier),
            username: highestWinRaw.user.username,
            createdAt: highestWinRaw.createdAt.toISOString(),
          }
        : null

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

    const recentActivity = recentTxRaw.map((tx) => ({
      id: tx.id,
      type: tx.type,
      username: tx.user.username,
      amount: Number(tx.amount),
      createdAt: tx.createdAt.toISOString(),
    }))

    const topWinners = topUsersRaw.map((u) => ({
      id: u.id,
      username: u.username,
      totalProfit: Number(u.balance) - 1000,
      balance: Number(u.balance),
    }))

    return {
      overview: {
        mainPot,
        totalWagered,
        totalPayout,
        houseProfit,
        todayWagered,
        todayProfit,
        realizedRtp: Math.round(realizedRtp * 10) / 10,
        totalRounds,
        wonRounds,
        lostRounds,
        winRate: Math.round(winRate * 10) / 10,
        averageBet: Math.round(averageBet * 100) / 100,
        activePlayersCount,
        totalUsersCount,
        bannedUsersCount,
        newUsersLast7Days: newUsers7d,
      },
      highestWin,
      gridDistribution: {
        '4x4': gridMap['4x4'] || 0,
        '5x5': gridMap['5x5'] || 0,
        '6x6': gridMap['6x6'] || 0,
      },
      chart7Days,
      topWinners,
      recentActivity,
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
