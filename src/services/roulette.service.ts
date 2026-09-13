import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  evaluateRouletteBets,
  generateRouletteNumber,
  getNumberColor,
  PlacedBet,
} from '../engine/roulette.engine'
import { ApiError, ForbiddenError, NotFoundError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { assertPositive, requiredDecimal } from '../utils/money'
import { WalletService } from './wallet.service'

const wallet = new WalletService()

export interface SpinRouletteInput {
  userId: string
  bets: PlacedBet[]
  clientSeed?: string
  idempotencyKey?: string
}

export class RouletteService {
  async spin(input: SpinRouletteInput) {
    const player = await prisma.user.findUnique({ where: { id: input.userId } })
    if (!player) throw new NotFoundError('Player not found')
    if (player.isBanned) {
      throw new ForbiddenError(
        player.bannedReason ? `Account suspended: ${player.bannedReason}` : 'Account is suspended'
      )
    }

    if (!Array.isArray(input.bets) || input.bets.length === 0) {
      throw new ApiError(400, 'At least one bet must be placed')
    }

    let totalBetNum = 0
    for (const b of input.bets) {
      if (typeof b.amount !== 'number' || b.amount <= 0) {
        throw new ApiError(400, 'Each bet amount must be a positive number')
      }
      if (!Array.isArray(b.numbers) || b.numbers.length === 0) {
        throw new ApiError(400, 'Each bet must cover at least one number')
      }
      totalBetNum += b.amount
    }

    totalBetNum = Math.round(totalBetNum * 100) / 100
    const totalBet = requiredDecimal(totalBetNum)
    assertPositive(totalBet, 'totalBet')

    const serverSeed = randomBytes(32).toString('hex')
    const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
    const clientSeed = input.clientSeed?.trim() || 'default-client-seed'

    const userSpinsCount = await prisma.rouletteRound.count({ where: { userId: input.userId } })
    const nonce = userSpinsCount + 1

    const winningNumber = generateRouletteNumber(serverSeed, clientSeed, nonce)
    const { evaluatedBets, totalPayout } = evaluateRouletteBets(input.bets, winningNumber)

    const payout = new Prisma.Decimal(totalPayout).toDP(8)
    const multiplier = totalBetNum > 0 ? payout.div(totalBet).toDP(8) : new Prisma.Decimal(0)

    const result = await prisma.$transaction(async (tx) => {
      // 1. Debit Bet
      await wallet.debit(tx, input.userId, totalBet, {
        type: 'BET',
        idempotencyKey: input.idempotencyKey,
      })

      // 2. Create Round
      const round = await tx.rouletteRound.create({
        data: {
          userId: input.userId,
          totalBet,
          winningNumber,
          bets: evaluatedBets as any,
          payout,
          multiplier,
          serverSeed,
          serverSeedHash,
          clientSeed,
        },
      })

      // 3. Credit Winnings if payout > 0
      let finalBalance = await this.getUserBalance(tx, input.userId)
      if (payout.greaterThan(0)) {
        finalBalance = await wallet.credit(tx, input.userId, payout, {
          type: 'WIN',
          roundId: round.id,
        })
      }

      return {
        roundId: round.id,
        balance: finalBalance.toNumber(),
      }
    })

    return {
      roundId: result.roundId,
      winningNumber,
      color: getNumberColor(winningNumber),
      totalBet: totalBetNum,
      payout: payout.toNumber(),
      multiplier: multiplier.toNumber(),
      evaluatedBets,
      balance: result.balance,
      serverSeedHash,
    }
  }

  async getHistory(userId: string, limit = 20) {
    const rounds = await prisma.rouletteRound.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        totalBet: true,
        winningNumber: true,
        payout: true,
        multiplier: true,
        createdAt: true,
      },
    })

    return rounds.map((r) => ({
      id: r.id,
      totalBet: r.totalBet.toNumber(),
      winningNumber: r.winningNumber,
      color: getNumberColor(r.winningNumber),
      payout: r.payout.toNumber(),
      multiplier: r.multiplier.toNumber(),
      createdAt: r.createdAt,
    }))
  }

  private async getUserBalance(tx: Prisma.TransactionClient, userId: string): Promise<Prisma.Decimal> {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })
    return u.balance
  }
}

export const rouletteService = new RouletteService()
