import { describe, expect, it } from 'vitest'
import {
  evaluateSpin,
  generateSlotGrid,
  PAYLINES,
  REELS_COUNT,
  ROWS_COUNT,
  SCATTER_ID,
  SYMBOLS,
  TOTAL_PAYLINES,
  WILD_ID,
} from './slots.engine'

describe('SlotsEngine', () => {
  it('generates a 5x3 grid deterministically with seed', () => {
    const grid1 = generateSlotGrid('seed-a', 'client-a', 1)
    const grid2 = generateSlotGrid('seed-a', 'client-a', 1)
    const grid3 = generateSlotGrid('seed-b', 'client-a', 1)

    expect(grid1).toHaveLength(REELS_COUNT)
    grid1.forEach((col) => {
      expect(col).toHaveLength(ROWS_COUNT)
      col.forEach((sym) => {
        expect(sym).toBeGreaterThanOrEqual(0)
        expect(sym).toBeLessThanOrEqual(8)
      })
    })

    // Deterministic check
    expect(grid1).toEqual(grid2)
    // Different seed gives different grid
    expect(grid1).not.toEqual(grid3)
  })

  it('evaluates top row 5-of-a-kind cherries properly', () => {
    // Top row line index is 1: [0, 0, 0, 0, 0]
    const customGrid: number[][] = [
      [0, 1, 2], // reel 0 (Cherry on row 0)
      [0, 2, 3], // reel 1 (Cherry on row 0)
      [0, 3, 4], // reel 2 (Cherry on row 0)
      [0, 4, 5], // reel 3 (Cherry on row 0)
      [0, 5, 6], // reel 4 (Cherry on row 0)
    ]

    const result = evaluateSpin(customGrid, 20, 1)
    expect(result.winningLines.length).toBeGreaterThanOrEqual(1)

    const topRowWin = result.winningLines.find((l) => l.lineIndex === 1)
    expect(topRowWin).toBeDefined()
    expect(topRowWin?.symbolId).toBe(0)
    expect(topRowWin?.matchCount).toBe(5)
    expect(topRowWin?.multiplier).toBe(SYMBOLS[0].payouts[5]) // 5.0
  })

  it('Wild substitutes for regular symbols', () => {
    // Line 0: Middle row [1, 1, 1, 1, 1]
    const customGrid: number[][] = [
      [2, 5, 2], // reel 0: Diamond on row 1
      [2, WILD_ID, 2], // reel 1: Wild on row 1
      [2, 5, 2], // reel 2: Diamond on row 1
      [2, 1, 2], // reel 3: Lemon on row 1 (stops streak)
      [2, 1, 2], // reel 4
    ]

    const result = evaluateSpin(customGrid, 20, 1)
    const midRowWin = result.winningLines.find((l) => l.lineIndex === 0)

    expect(midRowWin).toBeDefined()
    expect(midRowWin?.symbolId).toBe(5) // Diamond
    expect(midRowWin?.matchCount).toBe(3) // Diamond, Wild, Diamond
    expect(midRowWin?.multiplier).toBe(SYMBOLS[5].payouts[3]) // 8.0
  })

  it('awards free spins when 3 or more scatters land anywhere', () => {
    const customGrid: number[][] = [
      [SCATTER_ID, 0, 1], // reel 0
      [0, SCATTER_ID, 1], // reel 1
      [0, 1, SCATTER_ID], // reel 2
      [0, 1, 2],          // reel 3
      [0, 1, 2],          // reel 4
    ]

    const result = evaluateSpin(customGrid, 20, 1)
    expect(result.scatterCount).toBe(3)
    expect(result.freeSpinsWon).toBe(10)
    expect(result.scatterPayout).toBeGreaterThan(0)
  })
})
