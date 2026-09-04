import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  generateMinePositions,
  maxMinesForBoard,
  multiplierAt,
  normalizeBoardSize,
  potentialWin,
  totalTiles,
} from '../engine/mines.engine'
import { ApiError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { assertPositive, requiredDecimal } from '../utils/money'
import { WalletService } from './wallet.service'

const wallet = new WalletService()

interface LockedRoundRow {
  id: string
  userId: string
  bet: string
  mines: number
  boardSize: number
  minePositions: number[]
  status: 'ACTIVE' | 'WON' | 'LOST'
}

export interface StartRoundInput {
  userId: string
  bet: number | string | Prisma.Decimal
  mines: number
  boardSize: number
  clientSeed?: string
  idempotencyKey?: string
}

export interface RevealInput {
  userId: string
  roundId: string
  tileIndex: number
}

export interface CashOutInput {
  userId: string
  roundId: string
}

export class GameService {
  /**
   * Server-authoritative round start. Debits the bet atomically (idempotent on
   * `idempotencyKey`) and stores the secret mine positions server-side. The
   * client only ever receives the round id, the SHA-256 seed commitment and
   * the publicly known settings.
   */
  async startRound(input: StartRoundInput) {
    const bet = requiredDecimal(input.bet)
    assertPositive(bet, 'bet')
    const boardSize = normalizeBoardSize(input.boardSize)
    const mineSet = generateMinePositions(input.mines, boardSize)
    const serverSeed = randomBytes(32).toString('hex')
    const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
    const clientSeed = input.clientSeed?.trim() ?? ''

    const run = () =>
      prisma.$transaction(async (tx) => {
        const round = await tx.gameRound.create({
          data: {
            userId: input.userId,
            bet,
            mines: input.mines,
            boardSize,
            minePositions: Array.from(mineSet),
            serverSeed,
            serverSeedHash,
            clientSeed,
          },
          select: { id: true },
        })
        const balance = await wallet.debit(tx, input.userId, bet, {
          type: 'BET',
          roundId: round.id,
          idempotencyKey: input.idempotencyKey,
        })
        return { balance, roundId: round.id }
      })

    if (input.idempotencyKey) {
      const existing = await prisma.transaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { roundId: true },
      })
      if (existing?.roundId) {
        return this.recoverIdempotentRound(input.userId, input.idempotencyKey)
      }
    }

    try {
      const { balance, roundId } = await run()
      return {
        roundId,
        boardSize,
        mines: input.mines,
        status: 'ACTIVE',
        balance: balance.toNumber(),
        serverSeedHash,
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.recoverIdempotentRound(input.userId, input.idempotencyKey)
      }
      throw error
    }
  }

  async revealTile({ userId, roundId, tileIndex }: RevealInput) {
    return prisma.$transaction(async (tx) => {
      const round = await this.lockRound(tx, roundId)
      if (!round) throw new NotFoundError('Round not found')
      if (round.userId !== userId) throw new ForbiddenError('This round belongs to another user')
      if (round.status !== 'ACTIVE') throw new ConflictError('Round is already finished')

      if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= totalTiles(round.boardSize)) {
        throw new ApiError(400, `tileIndex must be an integer in 0..${totalTiles(round.boardSize) - 1}`)
      }

      const existing = await tx.reveal.findUnique({
        where: { roundId_tileIndex: { roundId, tileIndex } },
        select: { id: true },
      })
      if (existing) throw new ConflictError('Tile already revealed')

      const isMine = round.minePositions.includes(tileIndex)
      await tx.reveal.create({ data: { roundId, tileIndex, isMine } })

      if (isMine) {
        await tx.gameRound.update({ where: { id: roundId }, data: { status: 'LOST' } })
        const balance = await this.userBalance(tx, userId)
        return {
          safe: false,
          status: 'LOST',
          mineIndices: round.minePositions,
          balance: balance.toNumber(),
        }
      }

      const revealed = await tx.reveal.count({ where: { roundId } })
      const multiplier = new Prisma.Decimal(multiplierAt(round.mines, revealed, round.boardSize)).toDP(8)
      const pWin = new Prisma.Decimal(potentialWin(Number(round.bet), round.mines, revealed, round.boardSize)).toDP(8)
      await tx.gameRound.update({ where: { id: roundId }, data: { multiplier } })
      const balance = await this.userBalance(tx, userId)

      return {
        safe: true,
        revealed,
        multiplier: multiplier.toNumber(),
        potentialWin: pWin.toNumber(),
        balance: balance.toNumber(),
      }
    })
  }

  async cashOut({ userId, roundId }: CashOutInput) {
    return prisma.$transaction(async (tx) => {
      const round = await this.lockRound(tx, roundId)
      if (!round) throw new NotFoundError('Round not found')
      if (round.userId !== userId) throw new ForbiddenError('This round belongs to another user')
      if (round.status !== 'ACTIVE') throw new ConflictError('Round is already finished')

      const revealed = await tx.reveal.count({ where: { roundId } })
      if (revealed === 0) throw new ApiError(400, 'Reveal at least one tile before cashing out')

      const bet = new Prisma.Decimal(round.bet)
      const payout = new Prisma.Decimal(potentialWin(Number(round.bet), round.mines, revealed, round.boardSize)).toDP(8)
      const multiplier = payout.div(bet).toDP(8)

      const balance = await wallet.credit(tx, userId, payout, { type: 'WIN', roundId })
      await tx.gameRound.update({
        where: { id: roundId },
        data: { status: 'WON', payout, multiplier },
      })

      return {
        status: 'WON',
        multiplier: multiplier.toNumber(),
        payout: payout.toNumber(),
        balance: balance.toNumber(),
      }
    })
  }

  async listHistory(userId: string, limit = 20) {
    const rounds = await prisma.gameRound.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        bet: true,
        mines: true,
        boardSize: true,
        status: true,
        multiplier: true,
        payout: true,
        createdAt: true,
      },
    })
    return rounds.map((r) => ({
      id: r.id,
      bet: r.bet.toNumber(),
      mines: r.mines,
      boardSize: r.boardSize,
      status: r.status,
      multiplier: r.multiplier.toNumber(),
      payout: r.payout ? r.payout.toNumber() : null,
      createdAt: r.createdAt,
    }))
  }

  /** Locks the round row with SELECT ... FOR UPDATE to serialize concurrent actions. */
  private async lockRound(tx: Prisma.TransactionClient, roundId: string): Promise<LockedRoundRow | null> {
    const rows = await tx.$queryRaw<LockedRoundRow[]>`
      SELECT "id", "userId", "bet", "mines", "boardSize", "minePositions", "status"
      FROM "GameRound"
      WHERE "id" = ${roundId}
      FOR UPDATE
    `
    return rows[0] ?? null
  }

  private async userBalance(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })
    return user.balance
  }

  private async recoverIdempotentRound(userId: string, idempotencyKey?: string) {
    if (idempotencyKey && userId) {
      const tx = await prisma.transaction.findUnique({
        where: { idempotencyKey },
        select: { roundId: true },
      })
      if (tx?.roundId) {
        const round = await prisma.gameRound.findUniqueOrThrow({
          where: { id: tx.roundId },
          select: { id: true, boardSize: true, mines: true, bet: true, serverSeedHash: true },
        })
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { balance: true },
        })
        return {
          roundId: round.id,
          boardSize: round.boardSize,
          mines: round.mines,
          status: 'ACTIVE',
          balance: user.balance.toNumber(),
          serverSeedHash: round.serverSeedHash,
        }
      }
    }
    throw new ConflictError('Deterministic bet conflict')
  }
}

export const game = new GameService()
export { maxMinesForBoard }