import { Prisma } from '@prisma/client'
import { InsufficientBalanceError } from '../lib/errors'
import { assertNonNegative, assertPositive, requiredDecimal, toDecimal } from '../utils/money'

type WalletContext = Prisma.TransactionClient | PrismaClient

export interface WalletEntry {
  type: 'BET' | 'WIN' | 'DEPOSIT' | 'WITHDRAW'
  roundId?: string
  idempotencyKey?: string
}

export class WalletService {
  /**
   * Atomically deducts `amount` from the user's balance and records a
   * transaction row. Uses a conditional UPDATE (guaranteed atomic in
   * Postgres) so the balance can never go negative, even under concurrency.
   *
   * Passing an `idempotencyKey` makes the operation a no-op on retry: if the
   * key already exists the balance is left untouched and the current balance
   * is returned. The unique index is the race-proof guard.
   */
  async debit(
    ctx: WalletContext,
    userId: string,
    amount: number | string | Prisma.Decimal,
    entry: WalletEntry,
  ): Promise<Prisma.Decimal> {
    const amt = requiredDecimal(amount)
    assertPositive(amt, 'bet')

    if (entry.idempotencyKey) {
      const existing = await ctx.transaction.findUnique({
        where: { idempotencyKey: entry.idempotencyKey },
        select: { id: true },
      })
      if (existing) {
        const user = await ctx.user.findUniqueOrThrow({ where: { id: userId } })
        return user.balance
      }
    }

    const applied = await ctx.user.updateMany({
      where: { id: userId, balance: { gte: amt } },
      data: { balance: { decrement: amt } },
    })

    if (applied.count === 0) {
      throw new InsufficientBalanceError()
    }

    await ctx.transaction.create({
      data: {
        userId,
        type: entry.type,
        amount: amt,
        roundId: entry.roundId,
        idempotencyKey: entry.idempotencyKey,
      },
    })

    const user = await ctx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    })
    return user.balance
  }

  /**
   * Atomically adds `amount` to the user's balance and records a transaction
   * row. Same idempotency semantics as `debit`.
   */
  async credit(
    ctx: WalletContext,
    userId: string,
    amount: number | string | Prisma.Decimal,
    entry: WalletEntry,
  ): Promise<Prisma.Decimal> {
    const amt = requiredDecimal(amount)
    assertPositive(amt, 'payout')

    if (entry.idempotencyKey) {
      const existing = await ctx.transaction.findUnique({
        where: { idempotencyKey: entry.idempotencyKey },
        select: { id: true },
      })
      if (existing) {
        const user = await ctx.user.findUniqueOrThrow({ where: { id: userId } })
        return user.balance
      }
    }

    await ctx.user.update({
      where: { id: userId },
      data: { balance: { increment: amt } },
    })

    await ctx.transaction.create({
      data: {
        userId,
        type: entry.type,
        amount: amt,
        roundId: entry.roundId,
        idempotencyKey: entry.idempotencyKey,
      },
    })

    const user = await ctx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    })
    return user.balance
  }

  /** Read-only balance lookup. Returns the user's balance. */
  canAfford(user: { balance: Prisma.Decimal }, amount: number | string | Prisma.Decimal): boolean {
    const amt = toDecimal(amount)
    assertNonNegative(amt, 'balance check')
    return user.balance.gte(amt)
  }
}