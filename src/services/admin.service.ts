import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { multiplierAt, potentialWin } from '../engine/mines.engine'
import { WalletService } from './wallet.service'

const wallet = new WalletService()

export type AdminGameType = 'mines' | 'coinflip' | 'blackjack'

export interface UnifiedActiveRound {
  id: string
  gameType: AdminGameType
  userId: string
  username: string
  email: string
  bet: number
  stateSummary: string
  multiplier: number
  potentialWin: number
  createdAt: string
  mines?: number
  boardSize?: number
  revealedCount?: number
  streak?: number
  cardsCount?: number
  handScore?: number
}

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
  activeRounds: UnifiedActiveRound[]
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
  activeRounds: UnifiedActiveRound[]
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

    // Batch 4: Active players & unified active rounds feed
    const activeRounds = await this.getAllActiveRounds()
    const activePlayersCount = new Set(activeRounds.map((r) => r.userId)).size

    const mainPot = mainPotAgg._sum.balance ? Number(mainPotAgg._sum.balance) : 0
    const totalWagered = wageredAgg._sum.bet ? Number(wageredAgg._sum.bet) : 0
    const totalPayout = payoutAgg._sum.payout ? Number(payoutAgg._sum.payout) : 0
    const houseProfit = totalWagered - totalPayout

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

    // Batch 5: 7-day rounds, recent transactions & unified active rounds
    const [last7DaysRounds, recentTxRaw, activeRounds] = await Promise.all([
      prisma.gameRound.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { bet: true, payout: true, status: true, createdAt: true },
      }),
      prisma.transaction.findMany({
        take: 15,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true } } },
      }),
      this.getAllActiveRounds(),
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

  /**
   * Aggregates all live active rounds across all casino games (Mines, Coin Flip, Blackjack)
   */
  async getAllActiveRounds(gameTypeFilter?: AdminGameType | 'ALL'): Promise<UnifiedActiveRound[]> {
    const results: UnifiedActiveRound[] = []

    // 1. Mines
    if (!gameTypeFilter || gameTypeFilter === 'ALL' || gameTypeFilter === 'mines') {
      const minesRounds = await prisma.gameRound.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: { select: { username: true, email: true } },
          reveals: { select: { tileIndex: true, isMine: true } },
        },
      })

      for (const r of minesRounds) {
        const revealedCount = r.reveals.filter((rev) => !rev.isMine).length
        const mult = multiplierAt(r.mines, revealedCount, r.boardSize)
        const potential = potentialWin(Number(r.bet), r.mines, revealedCount, r.boardSize)

        results.push({
          id: r.id,
          gameType: 'mines',
          userId: r.userId,
          username: r.user.username,
          email: r.user.email,
          bet: Number(r.bet),
          stateSummary: `${revealedCount} gems / ${r.mines} mines (${r.boardSize}x${r.boardSize})`,
          multiplier: mult,
          potentialWin: potential,
          createdAt: r.createdAt.toISOString(),
          mines: r.mines,
          boardSize: r.boardSize,
          revealedCount,
        })
      }
    }

    // 2. Coin Flip
    if (!gameTypeFilter || gameTypeFilter === 'ALL' || gameTypeFilter === 'coinflip') {
      const coinRounds = await prisma.coinFlipRound.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: { select: { username: true, email: true } },
        },
      })

      for (const r of coinRounds) {
        const mult = Number(r.multiplier)
        const potential = Math.round(Number(r.bet) * mult * 100) / 100

        results.push({
          id: r.id,
          gameType: 'coinflip',
          userId: r.userId,
          username: r.user.username,
          email: r.user.email,
          bet: Number(r.bet),
          stateSummary: `Streak ${r.streak} (${mult.toFixed(2)}x)`,
          multiplier: mult,
          potentialWin: potential,
          createdAt: r.createdAt.toISOString(),
          streak: r.streak,
        })
      }
    }

    // 3. Blackjack
    if (!gameTypeFilter || gameTypeFilter === 'ALL' || gameTypeFilter === 'blackjack') {
      const bjRounds = await prisma.blackjackRound.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: { select: { username: true, email: true } },
        },
      })

      for (const r of bjRounds) {
        const playerHands = (r.playerHands as any[]) || []
        const hand = playerHands[0]
        const score = hand?.score ?? '?'
        const cardsCount = hand?.cards?.length ?? 2

        results.push({
          id: r.id,
          gameType: 'blackjack',
          userId: r.userId,
          username: r.user.username,
          email: r.user.email,
          bet: Number(r.bet),
          stateSummary: `Hand: ${cardsCount} cards (Score: ${score})`,
          multiplier: 2.0,
          potentialWin: Number(r.bet) * 2,
          createdAt: r.createdAt.toISOString(),
          cardsCount,
          handScore: typeof score === 'number' ? score : undefined,
        })
      }
    }

    // Sort by createdAt descending
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return results
  }

  /**
   * Stop / Force-Cancel / Force-Cashout a Live Active Round
   */
  async stopRound(
    gameType: AdminGameType,
    roundId: string,
    action: 'REFUND' | 'CASHOUT' = 'REFUND',
    reason = 'Cancelled by administrator'
  ) {
    return prisma.$transaction(async (tx) => {
      if (gameType === 'mines') {
        const round = await tx.gameRound.findUnique({
          where: { id: roundId },
          include: { reveals: true, user: { select: { username: true } } },
        })
        if (!round) throw new NotFoundError('Mines round not found')
        if (round.status !== 'ACTIVE') throw new ConflictError('Round is not currently active')

        let payout = 0
        let newStatus: 'CANCELLED' | 'WON' = 'CANCELLED'
        let txType: 'REFUND' | 'WIN' = 'REFUND'

        if (action === 'CASHOUT') {
          const revealedGems = round.reveals.filter((rev) => !rev.isMine).length
          payout = potentialWin(Number(round.bet), round.mines, revealedGems, round.boardSize)
          newStatus = 'WON'
          txType = 'WIN'
        } else {
          payout = Number(round.bet)
          newStatus = 'CANCELLED'
          txType = 'REFUND'
        }

        await tx.gameRound.update({
          where: { id: roundId },
          data: {
            status: newStatus,
            payout: new Prisma.Decimal(payout),
          },
        })

        if (payout > 0) {
          await wallet.credit(tx, round.userId, new Prisma.Decimal(payout), {
            type: txType,
            roundId,
          })
        }

        return {
          success: true,
          roundId,
          gameType,
          username: round.user.username,
          userId: round.userId,
          action,
          amountPaidOrRefunded: payout,
          status: newStatus,
          reason,
        }
      }

      if (gameType === 'coinflip') {
        const round = await tx.coinFlipRound.findUnique({
          where: { id: roundId },
          include: { user: { select: { username: true } } },
        })
        if (!round) throw new NotFoundError('Coin Flip round not found')
        if (round.status !== 'ACTIVE') throw new ConflictError('Round is not currently active')

        let payout = 0
        let newStatus: 'CANCELLED' | 'WON' = 'CANCELLED'
        let txType: 'REFUND' | 'WIN' = 'REFUND'

        if (action === 'CASHOUT' && round.streak > 0) {
          payout = Math.round(Number(round.bet) * Number(round.multiplier) * 100) / 100
          newStatus = 'WON'
          txType = 'WIN'
        } else {
          payout = Number(round.bet)
          newStatus = 'CANCELLED'
          txType = 'REFUND'
        }

        await tx.coinFlipRound.update({
          where: { id: roundId },
          data: {
            status: newStatus,
            payout: new Prisma.Decimal(payout),
          },
        })

        if (payout > 0) {
          await wallet.credit(tx, round.userId, new Prisma.Decimal(payout), {
            type: txType,
            roundId,
          })
        }

        return {
          success: true,
          roundId,
          gameType,
          username: round.user.username,
          userId: round.userId,
          action,
          amountPaidOrRefunded: payout,
          status: newStatus,
          reason,
        }
      }

      if (gameType === 'blackjack') {
        const round = await tx.blackjackRound.findUnique({
          where: { id: roundId },
          include: { user: { select: { username: true } } },
        })
        if (!round) throw new NotFoundError('Blackjack round not found')
        if (round.status !== 'ACTIVE') throw new ConflictError('Round is not currently active')

        const payout = Number(round.bet)
        await tx.blackjackRound.update({
          where: { id: roundId },
          data: {
            status: 'CANCELLED',
            payout: new Prisma.Decimal(payout),
          },
        })

        await wallet.credit(tx, round.userId, new Prisma.Decimal(payout), {
          type: 'REFUND',
          roundId,
        })

        return {
          success: true,
          roundId,
          gameType,
          username: round.user.username,
          userId: round.userId,
          action: 'REFUND',
          amountPaidOrRefunded: payout,
          status: 'CANCELLED',
          reason,
        }
      }

      throw new NotFoundError(`Unknown game type: ${gameType}`)
    })
  }

  /**
   * Stop all active rounds across one or all casino games
   */
  async stopAllActiveRounds(
    gameTypeFilter?: AdminGameType | 'ALL',
    reason = 'Emergency stop by administrator'
  ) {
    const active = await this.getAllActiveRounds(gameTypeFilter)
    const stopped: Array<{ id: string; gameType: AdminGameType; amount: number; username: string }> = []
    let totalRefunded = 0

    for (const r of active) {
      try {
        const res = await this.stopRound(r.gameType, r.id, 'REFUND', reason)
        stopped.push({
          id: r.id,
          gameType: r.gameType,
          amount: res.amountPaidOrRefunded,
          username: res.username,
        })
        totalRefunded += res.amountPaidOrRefunded
      } catch (_) {
        // Round might have resolved in parallel, continue stopping remainder
      }
    }

    return {
      success: true,
      stoppedCount: stopped.length,
      totalRefunded: Math.round(totalRefunded * 100) / 100,
      stopped,
      reason,
    }
  }
}

export const adminService = new AdminService()
