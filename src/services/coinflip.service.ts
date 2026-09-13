import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  CoinSide,
  generateCoinFlip,
  getStreakMultiplier,
  getStreakPayout,
} from '../engine/coinflip.engine'
import { ApiError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { assertPositive, requiredDecimal } from '../utils/money'
import { WalletService } from './wallet.service'

const wallet = new WalletService()

export interface StartCoinFlipInput {
  userId: string
  bet: number
  clientSeed?: string
  idempotencyKey?: string
}

export interface FlipInput {
  userId: string
  roundId: string
  guess: CoinSide
}

export class CoinFlipService {
  async startRound(input: StartCoinFlipInput) {
    const player = await prisma.user.findUnique({ where: { id: input.userId } })
    if (!player) throw new NotFoundError('Player not found')
    if (player.isBanned) {
      throw new ForbiddenError(
        player.bannedReason ? `Account suspended: ${player.bannedReason}` : 'Account is suspended'
      )
    }

    const bet = requiredDecimal(input.bet)
    assertPositive(bet, 'bet')

    const serverSeed = randomBytes(32).toString('hex')
    const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
    const clientSeed = input.clientSeed?.trim() || 'default-client-seed'

    return prisma.$transaction(async (tx) => {
      const round = await tx.coinFlipRound.create({
        data: {
          userId: input.userId,
          bet,
          streak: 0,
          multiplier: 1.0,
          flips: [],
          status: 'ACTIVE',
          serverSeed,
          serverSeedHash,
          clientSeed,
        },
      })

      const balance = await wallet.debit(tx, input.userId, bet, {
        type: 'BET',
        roundId: round.id,
        idempotencyKey: input.idempotencyKey,
      })

      return {
        roundId: round.id,
        bet: bet.toNumber(),
        status: 'ACTIVE',
        balance: balance.toNumber(),
        serverSeedHash,
      }
    })
  }

  async flip({ userId, roundId, guess }: FlipInput) {
    return prisma.$transaction(async (tx) => {
      const round = await tx.coinFlipRound.findUnique({ where: { id: roundId } })
      if (!round) throw new NotFoundError('Round not found')
      if (round.userId !== userId) throw new ForbiddenError('This round belongs to another user')
      if (round.status !== 'ACTIVE') throw new ConflictError('Round is already finished')

      const currentFlips = (round.flips as any[]) || []
      const nonce = currentFlips.length + 1
      const outcome = generateCoinFlip(round.serverSeed, round.clientSeed, nonce)
      const won = guess === outcome

      if (won) {
        const nextStreak = round.streak + 1
        const nextMultiplier = getStreakMultiplier(nextStreak)
        const nextPayout = getStreakPayout(Number(round.bet), nextStreak)

        const updatedFlips = [
          ...currentFlips,
          { guess, outcome, won: true, streak: nextStreak, multiplier: nextMultiplier },
        ]

        await tx.coinFlipRound.update({
          where: { id: roundId },
          data: {
            streak: nextStreak,
            multiplier: new Prisma.Decimal(nextMultiplier),
            flips: updatedFlips,
          },
        })

        const balance = await this.getUserBalance(tx, userId)

        return {
          won: true,
          outcome,
          streak: nextStreak,
          multiplier: nextMultiplier,
          potentialPayout: nextPayout,
          status: 'ACTIVE',
          balance: balance.toNumber(),
        }
      } else {
        const updatedFlips = [
          ...currentFlips,
          { guess, outcome, won: false, streak: 0, multiplier: 0 },
        ]

        await tx.coinFlipRound.update({
          where: { id: roundId },
          data: {
            status: 'LOST',
            multiplier: 0,
            payout: 0,
            flips: updatedFlips,
          },
        })

        const balance = await this.getUserBalance(tx, userId)

        return {
          won: false,
          outcome,
          streak: 0,
          multiplier: 0,
          potentialPayout: 0,
          status: 'LOST',
          balance: balance.toNumber(),
        }
      }
    })
  }

  async cashout(userId: string, roundId: string) {
    return prisma.$transaction(async (tx) => {
      const round = await tx.coinFlipRound.findUnique({ where: { id: roundId } })
      if (!round) throw new NotFoundError('Round not found')
      if (round.userId !== userId) throw new ForbiddenError('This round belongs to another user')
      if (round.status !== 'ACTIVE') throw new ConflictError('Round is already finished')
      if (round.streak === 0) throw new ApiError(400, 'Flip at least once before cashing out')

      const payout = new Prisma.Decimal(getStreakPayout(Number(round.bet), round.streak)).toDP(8)
      const multiplier = new Prisma.Decimal(getStreakMultiplier(round.streak)).toDP(8)

      const balance = await wallet.credit(tx, userId, payout, { type: 'WIN', roundId })

      await tx.coinFlipRound.update({
        where: { id: roundId },
        data: {
          status: 'WON',
          payout,
          multiplier,
        },
      })

      return {
        status: 'WON',
        payout: payout.toNumber(),
        multiplier: multiplier.toNumber(),
        streak: round.streak,
        balance: balance.toNumber(),
      }
    })
  }

  async getHistory(userId: string, limit = 20) {
    const rounds = await prisma.coinFlipRound.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        bet: true,
        payout: true,
        multiplier: true,
        streak: true,
        status: true,
        flips: true,
        createdAt: true,
      },
    })

    return rounds.map((r) => ({
      id: r.id,
      bet: r.bet.toNumber(),
      payout: r.payout ? r.payout.toNumber() : 0,
      multiplier: r.multiplier.toNumber(),
      streak: r.streak,
      status: r.status,
      flips: r.flips,
      createdAt: r.createdAt,
    }))
  }

  private async getUserBalance(tx: Prisma.TransactionClient, userId: string): Promise<Prisma.Decimal> {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })
    return u.balance
  }
}

export const coinFlipService = new CoinFlipService()
