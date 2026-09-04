import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InsufficientBalanceError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { WalletService } from './wallet.service'

const wallet = new WalletService()

function randomUser() {
  const n = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    username: `u_${n}`,
    email: `e_${n}@test.dev`,
  }
}

describe('WalletService', () => {
  const createdIds: string[] = []

  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } })
    await prisma.$disconnect()
  })

  async function createUser(balance = '1000.00') {
    const u = await prisma.user.create({
      data: { ...randomUser(), passwordHash: 'x', balance },
    })
    createdIds.push(u.id)
    return u
  }

  it('debits the balance and records a BET transaction atomically', async () => {
    const user = await createUser()
    const balance = await prisma.$transaction(async (tx) =>
      wallet.debit(tx, user.id, 10, { type: 'BET' }),
    )

    expect(Number(balance)).toBeCloseTo(990, 8)
    const txns = await prisma.transaction.findMany({ where: { userId: user.id } })
    expect(txns).toHaveLength(1)
    expect(txns[0].type).toBe('BET')
    expect(Number(txns[0].amount)).toBeCloseTo(10, 8)
  })

  it('rejects a bet larger than the balance', async () => {
    const user = await createUser('5.00')
    await expect(
      prisma.$transaction(async (tx) => wallet.debit(tx, user.id, 10, { type: 'BET' })),
    ).rejects.toBeInstanceOf(InsufficientBalanceError)

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(Number(after.balance)).toBeCloseTo(5, 8)
    const txns = await prisma.transaction.count({ where: { userId: user.id } })
    expect(txns).toBe(0)
  })

  it('credits the balance and records a WIN transaction', async () => {
    const user = await createUser()
    const balance = await prisma.$transaction(async (tx) =>
      wallet.credit(tx, user.id, 21.4, { type: 'WIN' }),
    )

    expect(Number(balance)).toBeCloseTo(1021.4, 8)
    const txns = await prisma.transaction.findMany({ where: { userId: user.id } })
    expect(txns[0].type).toBe('WIN')
  })

  it('does not double-apply an idempotent bet twice', async () => {
    const user = await createUser()
    const key = `bet-${user.id}`
    const run = () =>
      prisma.$transaction((tx) => wallet.debit(tx, user.id, 10, { type: 'BET', idempotencyKey: key }))

    const first = await run()
    const second = await run()

    expect(Number(first)).toBeCloseTo(990, 8)
    expect(Number(second)).toBeCloseTo(990, 8)
    const txns = await prisma.transaction.findMany({
      where: { userId: user.id, idempotencyKey: key },
    })
    expect(txns).toHaveLength(1)
  })

  it('keeps balance non-negative across sequential bets', async () => {
    const user = await createUser('1.00')
    const ok = await prisma.$transaction((tx) => wallet.debit(tx, user.id, 1, { type: 'BET' }))
    expect(Number(ok)).toBeCloseTo(0, 8)
    await expect(
      prisma.$transaction((tx) => wallet.debit(tx, user.id, 1, { type: 'BET' })),
    ).rejects.toBeInstanceOf(InsufficientBalanceError)
  })

  it('stores Decimal precision exactly (18,8)', () => {
    const d = new Prisma.Decimal('0.123456789')
    expect(d.toDP(8).toString()).toBe('0.12345679')
  })
})