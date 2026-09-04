import 'dotenv/config'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { totalTiles } from '../engine/mines.engine'
import { ConflictError, ForbiddenError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { game } from './game.service'

describe('GameService', () => {
  const createdUserIds: string[] = []
  let playerId: string

  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    const n = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const user = await prisma.user.create({
      data: { username: `g_${n}`, email: `g_${n}@test.dev`, passwordHash: 'x', balance: '1000.00' },
    })
    createdUserIds.push(user.id)
    playerId = user.id
  })

  async function roundMines(roundId: string): Promise<number[]> {
    const r = await prisma.gameRound.findUniqueOrThrow({ where: { id: roundId } })
    return r.minePositions
  }

  it('starts a round: debits bet, hides positions, commits seed hash', async () => {
    const res = await game.startRound({ userId: playerId, bet: 10, mines: 5, boardSize: 5 })
    expect(res.roundId).toBeTruthy()
    expect(res.status).toBe('ACTIVE')
    expect(res.balance).toBeCloseTo(990, 8)
    expect(res.serverSeedHash).toMatch(/^[0-9a-f]{64}$/)

    const round = await prisma.gameRound.findUniqueOrThrow({ where: { id: res.roundId } })
    expect(round.minePositions).toHaveLength(5)
    expect(round.serverSeed).toHaveLength(64)

    const txns = await prisma.transaction.findMany({ where: { userId: playerId } })
    expect(txns).toHaveLength(1)
    expect(txns[0].type).toBe('BET')

    const balance = await prisma.user.findUniqueOrThrow({ where: { id: playerId } })
    expect(Number(balance.balance)).toBeCloseTo(990, 8)
  })

  it('reveals safe tiles and increases multiplier/potential win', async () => {
    const started = await game.startRound({ userId: playerId, bet: 10, mines: 4, boardSize: 5 })
    const mines = new Set(await roundMines(started.roundId))
    const safe = Array.from({ length: totalTiles(5) }, (_, i) => i).find((i) => !mines.has(i))!

    const first = await game.revealTile({ userId: playerId, roundId: started.roundId, tileIndex: safe })
    expect(first.safe).toBe(true)
    expect(first.revealed).toBe(1)
    expect(first.multiplier).toBeGreaterThan(1)
    expect(first.balance).toBeCloseTo(990, 8)
  })

  it('hitting a mine ends the round and reveals all positions', async () => {
    const started = await game.startRound({ userId: playerId, bet: 10, mines: 3, boardSize: 4 })
    const mineList = await roundMines(started.roundId)

    const res = await game.revealTile({ userId: playerId, roundId: started.roundId, tileIndex: mineList[0] })
    expect(res.safe).toBe(false)
    expect(res.status).toBe('LOST')
    expect(res.mineIndices.sort()).toEqual([...mineList].sort())

    await expect(
      game.revealTile({ userId: playerId, roundId: started.roundId, tileIndex: mineList[1] }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('cashes out and credits the payout', async () => {
    const started = await game.startRound({ userId: playerId, bet: 10, mines: 2, boardSize: 5 })
    const mines = new Set(await roundMines(started.roundId))
    const safeTiles = Array.from({ length: totalTiles(5) }, (_, i) => i).filter((i) => !mines.has(i))

    await game.revealTile({ userId: playerId, roundId: started.roundId, tileIndex: safeTiles[0] })
    await game.revealTile({ userId: playerId, roundId: started.roundId, tileIndex: safeTiles[1] })

    const res = await game.cashOut({ userId: playerId, roundId: started.roundId })
    expect(res.status).toBe('WON')
    expect(res.payout).toBeGreaterThan(10)
    expect(res.balance).toBeCloseTo(1000 - 10 + res.payout, 8)

    const balance = await prisma.user.findUniqueOrThrow({ where: { id: playerId } })
    expect(Number(balance.balance)).toBeCloseTo(res.balance, 8)
    const win = await prisma.transaction.findFirst({ where: { userId: playerId, type: 'WIN' } })
    expect(win).toBeTruthy()
    expect(Number(win!.amount)).toBeCloseTo(res.payout, 8)
  })

  it('cannot cash out without any reveal', async () => {
    const started = await game.startRound({ userId: playerId, bet: 10, mines: 3, boardSize: 5 })
    await expect(game.cashOut({ userId: playerId, roundId: started.roundId })).rejects.toThrow(
      /Reveal at least one tile/,
    )
  })

  it('cannot play another users round', async () => {
    const started = await game.startRound({ userId: playerId, bet: 10, mines: 3, boardSize: 5 })
    const other = await prisma.user.create({
      data: {
        username: `h_${Date.now()}`,
        email: `h_${Date.now()}@test.dev`,
        passwordHash: 'x',
        balance: '1000.00',
      },
    })
    createdUserIds.push(other.id)

    await expect(
      game.revealTile({ userId: other.id, roundId: started.roundId, tileIndex: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      game.cashOut({ userId: other.id, roundId: started.roundId }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('same idempotency key only debits once', async () => {
    const key = `start-${playerId}`

    const a = await game.startRound({ userId: playerId, bet: 10, mines: 3, boardSize: 5, idempotencyKey: key })
    const b = await game.startRound({ userId: playerId, bet: 10, mines: 3, boardSize: 5, idempotencyKey: key })

    expect(b.roundId).toBe(a.roundId)
    expect(b.balance).toBeCloseTo(990, 8)
    const bets = await prisma.transaction.count({ where: { userId: playerId, type: 'BET' } })
    expect(bets).toBe(1)
  })

  it('lists round history newest first', async () => {
    await game.startRound({ userId: playerId, bet: 5, mines: 2, boardSize: 4 })
    await game.startRound({ userId: playerId, bet: 7, mines: 3, boardSize: 5 })

    const history = await game.listHistory(playerId, 10)
    expect(history).toHaveLength(2)
    expect(history[0].bet).toBe(7)
    expect(history[0].mines).toBe(3)
  })
})