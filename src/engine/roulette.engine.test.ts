import { describe, expect, it } from 'vitest'
import {
  evaluateRouletteBets,
  generateRouletteNumber,
  getNumberColor,
  WHEEL_NUMBERS,
} from './roulette.engine'

describe('RouletteEngine', () => {
  it('wheel contains all 37 European numbers exactly once', () => {
    expect(WHEEL_NUMBERS).toHaveLength(37)
    const set = new Set(WHEEL_NUMBERS)
    expect(set.size).toBe(37)
    for (let i = 0; i <= 36; i++) {
      expect(set.has(i)).toBe(true)
    }
  })

  it('correctly maps numbers to colors', () => {
    expect(getNumberColor(0)).toBe('GREEN')
    expect(getNumberColor(7)).toBe('RED')
    expect(getNumberColor(2)).toBe('BLACK')
  })

  it('evaluates straight and outside bets correctly', () => {
    const bets = [
      { type: 'STRAIGHT' as const, numbers: [17], amount: 10 },
      { type: 'RED' as const, numbers: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36], amount: 20 },
      { type: 'BLACK' as const, numbers: [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35], amount: 15 },
    ]

    // When 17 lands (Black, odd)
    const res = evaluateRouletteBets(bets, 17)
    expect(res.evaluatedBets[0].won).toBe(true)
    expect(res.evaluatedBets[0].payout).toBe(360) // 10 * 36

    expect(res.evaluatedBets[1].won).toBe(false)
    expect(res.evaluatedBets[1].payout).toBe(0)

    expect(res.evaluatedBets[2].won).toBe(true)
    expect(res.evaluatedBets[2].payout).toBe(30) // 15 * 2

    expect(res.totalPayout).toBe(390)
  })

  it('generates deterministic roulette number bounded in 0..36', () => {
    for (let i = 1; i <= 20; i++) {
      const num = generateRouletteNumber('srv-seed', 'cli-seed', i)
      expect(num).toBeGreaterThanOrEqual(0)
      expect(num).toBeLessThanOrEqual(36)
    }
  })
})
