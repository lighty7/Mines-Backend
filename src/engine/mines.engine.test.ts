import { describe, expect, it } from 'vitest'
import {
  generateMinePositions,
  maxMinesForBoard,
  mineChancePercentage,
  multiplierAt,
  potentialWin,
  safeChancePercentage,
  safeProbability,
  totalTiles,
} from './mines.engine'

describe('MinesEngine (TypeScript port of MinesEngine.kt)', () => {
  it('mine positions are within board and unique', () => {
    for (let i = 0; i < 100; i++) {
      const positions = generateMinePositions(10, 5)
      expect(positions.size).toBe(10)
      positions.forEach((p) => expect(p).toBeGreaterThanOrEqual(0))
      positions.forEach((p) => expect(p).toBeLessThan(totalTiles(5)))
    }

    const smallBoard = generateMinePositions(3, 4)
    expect(smallBoard.size).toBe(3)
    smallBoard.forEach((p) => {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(totalTiles(4))
    })
  })

  it('multiplier increases with each safe pick', () => {
    let previous = multiplierAt(5, 0)
    for (let k = 1; k <= 10; k++) {
      const current = multiplierAt(5, k)
      expect(current).toBeGreaterThan(previous)
      previous = current
    }
  })

  it('multiplier matches 99 percent RTP formula', () => {
    const v = multiplierAt(5, 1)
    expect(v).toBeCloseTo(1.2375, 9)
  })

  it('safe probability is bounded', () => {
    expect(safeProbability(5, 0)).toBeCloseTo(0.8, 9)
    expect(safeProbability(1, 23)).toBeCloseTo(0.5, 9)
    expect(safeProbability(3, 0, 4)).toBeCloseTo(0.8125, 9)
    expect(safeProbability(0, 0)).toBeCloseTo(1, 9)
  })

  it('mine chance percentage reflects board size', () => {
    expect(mineChancePercentage(5, 5)).toBeCloseTo(20, 9)
    expect(mineChancePercentage(4, 4)).toBeCloseTo(25, 9)
    expect(safeChancePercentage(5, 5)).toBeCloseTo(80, 9)
  })

  it('validates board size and mine count', () => {
    expect(() => generateMinePositions(10, 3)).toThrow(/boardSize/)
    expect(() => generateMinePositions(10, 7)).toThrow(/boardSize/)
    expect(() => generateMinePositions(0, 5)).toThrow(/mines/)
    expect(() => generateMinePositions(maxMinesForBoard(5) + 1, 5)).toThrow(/mines/)
  })

  it('potentialWin is bet times multiplier', () => {
    const bet = 10
    const v = potentialWin(bet, 5, 2)
    expect(v).toBeCloseTo(bet * multiplierAt(5, 2), 9)
  })
})