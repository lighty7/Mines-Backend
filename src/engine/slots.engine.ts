import { createHmac, randomBytes } from 'node:crypto'

export interface SlotSymbol {
  id: number
  name: string
  char: string
  weight: number // Relative frequency on reel strips
  payouts: {
    3: number
    4: number
    5: number
  }
  isWild?: boolean
  isScatter?: boolean
}

export const SYMBOLS: Record<number, SlotSymbol> = {
  0: { id: 0, name: 'Cherry', char: '🍒', weight: 28, payouts: { 3: 0.5, 4: 1.5, 5: 5.0 } },
  1: { id: 1, name: 'Lemon', char: '🍋', weight: 24, payouts: { 3: 0.8, 4: 2.0, 5: 8.0 } },
  2: { id: 2, name: 'Grape', char: '🍇', weight: 20, payouts: { 3: 1.2, 4: 3.5, 5: 12.0 } },
  3: { id: 3, name: 'Bell', char: '🔔', weight: 16, payouts: { 3: 2.0, 4: 6.0, 5: 25.0 } },
  4: { id: 4, name: 'Bar', char: '🍫', weight: 12, payouts: { 3: 4.0, 4: 12.0, 5: 50.0 } },
  5: { id: 5, name: 'Diamond', char: '💎', weight: 8, payouts: { 3: 8.0, 4: 25.0, 5: 100.0 } },
  6: { id: 6, name: 'Seven', char: '7️⃣', weight: 4, payouts: { 3: 20.0, 4: 100.0, 5: 500.0 } },
  7: { id: 7, name: 'Wild', char: '⚡', weight: 3, isWild: true, payouts: { 3: 25.0, 4: 150.0, 5: 750.0 } },
  8: { id: 8, name: 'Scatter', char: '⭐', weight: 2, isScatter: true, payouts: { 3: 2.0, 4: 10.0, 5: 50.0 } },
}

export const WILD_ID = 7
export const SCATTER_ID = 8

export const REELS_COUNT = 5
export const ROWS_COUNT = 3
export const TOTAL_PAYLINES = 20

/**
 * 20 Standard 5-Reel Slot Paylines (row indices 0 = top, 1 = mid, 2 = bottom)
 */
export const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1], // 1. Middle row
  [0, 0, 0, 0, 0], // 2. Top row
  [2, 2, 2, 2, 2], // 3. Bottom row
  [0, 1, 2, 1, 0], // 4. V-shape
  [2, 1, 0, 1, 2], // 5. Inverted V-shape
  [0, 0, 1, 0, 0], // 6. Top dip
  [2, 2, 1, 2, 2], // 7. Bottom rise
  [1, 2, 2, 2, 1], // 8. Shallow valley
  [1, 0, 0, 0, 1], // 9. Shallow peak
  [1, 0, 1, 0, 1], // 10. Zigzag top
  [1, 2, 1, 2, 1], // 11. Zigzag bottom
  [0, 1, 0, 1, 0], // 12. Top/mid wave
  [2, 1, 2, 1, 2], // 13. Bottom/mid wave
  [0, 1, 1, 1, 0], // 14. Top curve
  [2, 1, 1, 1, 2], // 15. Bottom curve
  [0, 2, 0, 2, 0], // 16. Full zigzag
  [2, 0, 2, 0, 2], // 17. Inverted full zigzag
  [0, 0, 2, 0, 0], // 18. High dip
  [2, 2, 0, 2, 2], // 19. Low jump
  [1, 1, 0, 1, 1], // 20. Mid peak
]

/**
 * Builds weighted reel strip
 */
function buildReelStrip(): number[] {
  const strip: number[] = []
  for (const [idStr, sym] of Object.entries(SYMBOLS)) {
    const id = Number(idStr)
    for (let i = 0; i < sym.weight; i++) {
      strip.push(id)
    }
  }
  return strip
}

export const REEL_STRIP = buildReelStrip()

export interface WinningLine {
  lineIndex: number
  symbolId: number
  symbolName: string
  matchCount: number
  multiplier: number
  payout: number
  positions: Array<{ reel: number; row: number }>
}

export interface SpinEvaluation {
  grid: number[][] // 5 columns x 3 rows
  winningLines: WinningLine[]
  totalMultiplier: number
  scatterCount: number
  freeSpinsWon: number
  scatterPayout: number
}

/**
 * Generates a 5x3 slot grid deterministically from HMAC-SHA256 (provably fair)
 */
export function generateSlotGrid(serverSeed: string, clientSeed: string, nonce: number = 0): number[][] {
  const grid: number[][] = []
  const stripLength = REEL_STRIP.length

  for (let reel = 0; reel < REELS_COUNT; reel++) {
    const hmac = createHmac('sha256', serverSeed)
    hmac.update(`${clientSeed}:${nonce}:${reel}`)
    const hash = hmac.digest('hex')

    // Read first 8 chars as integer to get stop index
    const stopIndex = Number.parseInt(hash.slice(0, 8), 16) % stripLength

    const column: number[] = []
    for (let row = 0; row < ROWS_COUNT; row++) {
      const idx = (stopIndex + row) % stripLength
      column.push(REEL_STRIP[idx])
    }
    grid.push(column)
  }

  return grid
}

/**
 * Evaluates paylines and scatter outcomes on a 5x3 grid
 */
export function evaluateSpin(grid: number[][], lineCount: number = TOTAL_PAYLINES, betPerLine: number = 1): SpinEvaluation {
  const activeLines = PAYLINES.slice(0, Math.min(Math.max(lineCount, 1), TOTAL_PAYLINES))
  const winningLines: WinningLine[] = []
  let totalMultiplier = 0

  // 1. Evaluate Paylines (Left to Right)
  for (let lIdx = 0; lIdx < activeLines.length; lIdx++) {
    const line = activeLines[lIdx]
    const symbolsOnLine: number[] = []
    const positions: Array<{ reel: number; row: number }> = []

    for (let reel = 0; reel < REELS_COUNT; reel++) {
      const row = line[reel]
      symbolsOnLine.push(grid[reel][row])
      positions.push({ reel, row })
    }

    // Determine target symbol (first non-wild, non-scatter)
    let targetSymbolId: number | null = null
    for (const symId of symbolsOnLine) {
      if (symId !== SCATTER_ID) {
        if (symId !== WILD_ID) {
          targetSymbolId = symId
          break
        }
      }
    }

    // If line has only wilds (rare jackpot)
    if (targetSymbolId === null) {
      targetSymbolId = WILD_ID
    }

    // Count consecutive matches starting from reel 0
    let matchCount = 0
    for (let reel = 0; reel < REELS_COUNT; reel++) {
      const current = symbolsOnLine[reel]
      if (current === targetSymbolId || current === WILD_ID) {
        matchCount++
      } else {
        break
      }
    }

    if (matchCount >= 3) {
      const sym = SYMBOLS[targetSymbolId]
      const lineMultiplier = (sym?.payouts as Record<number, number>)?.[matchCount] || 0
      if (lineMultiplier > 0) {
        const linePayout = lineMultiplier * betPerLine
        totalMultiplier += lineMultiplier
        winningLines.push({
          lineIndex: lIdx,
          symbolId: targetSymbolId,
          symbolName: sym.name,
          matchCount,
          multiplier: lineMultiplier,
          payout: Math.round(linePayout * 100) / 100,
          positions: positions.slice(0, matchCount),
        })
      }
    }
  }

  // 2. Count Scatters across entire grid (anywhere on board)
  let scatterCount = 0
  for (let reel = 0; reel < REELS_COUNT; reel++) {
    for (let row = 0; row < ROWS_COUNT; row++) {
      if (grid[reel][row] === SCATTER_ID) {
        scatterCount++
      }
    }
  }

  let freeSpinsWon = 0
  let scatterMultiplier = 0

  if (scatterCount >= 5) {
    freeSpinsWon = 25
    scatterMultiplier = SYMBOLS[SCATTER_ID].payouts[5]
  } else if (scatterCount === 4) {
    freeSpinsWon = 15
    scatterMultiplier = SYMBOLS[SCATTER_ID].payouts[4]
  } else if (scatterCount === 3) {
    freeSpinsWon = 10
    scatterMultiplier = SYMBOLS[SCATTER_ID].payouts[3]
  }

  const totalBet = lineCount * betPerLine
  const scatterPayout = Math.round(scatterMultiplier * totalBet * 100) / 100

  return {
    grid,
    winningLines,
    totalMultiplier: Math.round((totalMultiplier + scatterMultiplier) * 100) / 100,
    scatterCount,
    freeSpinsWon,
    scatterPayout,
  }
}
