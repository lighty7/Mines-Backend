import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  evaluateSpin,
  generateSlotGrid,
  PAYLINES,
  SYMBOLS,
  TOTAL_PAYLINES,
} from '../engine/slots.engine'
import { ForbiddenError, NotFoundError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { assertPositive, requiredDecimal } from '../utils/money'
import { WalletService } from './wallet.service'

const wallet = new WalletService()

export interface SpinInput {
  userId: string
  betPerLine: number
  lines?: number
  clientSeed?: string
  idempotencyKey?: string
}

export class SlotsService {
  /**
   * Executes a provably fair 5x3 slot spin with atomic wallet deduction and payout
   */
  async spin(input: SpinInput) {
    const player = await prisma.user.findUnique({ where: { id: input.userId } })
    if (!player) throw new NotFoundError('Player not found')
    if (player.isBanned) {
      throw new ForbiddenError(
        player.bannedReason ? `Account suspended: ${player.bannedReason}` : 'Account is suspended'
      )
    }

    const lines = Math.min(Math.max(input.lines ?? TOTAL_PAYLINES, 1), TOTAL_PAYLINES)
    const betPerLine = Math.max(0.01, Math.round(input.betPerLine * 100) / 100)
    const totalBetNum = Math.round(betPerLine * lines * 100) / 100
    const totalBet = requiredDecimal(totalBetNum)
    assertPositive(totalBet, 'totalBet')

    const serverSeed = randomBytes(32).toString('hex')
    const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
    const clientSeed = input.clientSeed?.trim() || 'default-client-seed'

    // Monotonic nonce per user
    const userSpinsCount = await prisma.slotRound.count({ where: { userId: input.userId } })
    const nonce = userSpinsCount + 1

    // Generate outcome
    const grid = generateSlotGrid(serverSeed, clientSeed, nonce)
    const evaluation = evaluateSpin(grid, lines, betPerLine)

    const totalPayoutNum = evaluation.winningLines.reduce((sum, l) => sum + l.payout, 0) + evaluation.scatterPayout
    const payout = new Prisma.Decimal(totalPayoutNum).toDP(8)
    const multiplier = new Prisma.Decimal(evaluation.totalMultiplier).toDP(8)

    // Atomic transaction: Debit bet, credit payout (if won), save SlotRound
    const result = await prisma.$transaction(async (tx) => {
      // 1. Debit Bet
      await wallet.debit(tx, input.userId, totalBet, {
        type: 'BET',
        idempotencyKey: input.idempotencyKey,
      })

      // 2. Create SlotRound
      const round = await tx.slotRound.create({
        data: {
          userId: input.userId,
          bet: totalBet,
          payout,
          multiplier,
          grid: evaluation.grid as any,
          winningLines: evaluation.winningLines as any,
          freeSpinsWon: evaluation.freeSpinsWon,
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
      grid: evaluation.grid,
      winningLines: evaluation.winningLines,
      totalMultiplier: multiplier.toNumber(),
      payout: payout.toNumber(),
      freeSpinsWon: evaluation.freeSpinsWon,
      scatterCount: evaluation.scatterCount,
      balance: result.balance,
      serverSeedHash,
    }
  }

  async getPaytable() {
    return {
      symbols: SYMBOLS,
      paylines: PAYLINES,
      totalLines: TOTAL_PAYLINES,
      rtp: 0.965,
    }
  }

  async getHistory(userId: string, limit = 20) {
    const rounds = await prisma.slotRound.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        bet: true,
        payout: true,
        multiplier: true,
        grid: true,
        winningLines: true,
        freeSpinsWon: true,
        createdAt: true,
      },
    })

    return rounds.map((r) => ({
      id: r.id,
      bet: r.bet.toNumber(),
      payout: r.payout.toNumber(),
      multiplier: r.multiplier.toNumber(),
      grid: r.grid,
      winningLines: r.winningLines,
      freeSpinsWon: r.freeSpinsWon,
      createdAt: r.createdAt,
    }))
  }

  private async getUserBalance(tx: Prisma.TransactionClient, userId: string): Promise<Prisma.Decimal> {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })
    return u.balance
  }
}

export const slotsService = new SlotsService()
