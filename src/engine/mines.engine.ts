import { randomInt } from 'node:crypto'

export const MIN_BOARD_SIZE = 4
export const MAX_BOARD_SIZE = 6
export const DEFAULT_BOARD_SIZE = 5
export const HOUSE_EDGE = 0.99

export type BoardSize = 4 | 5 | 6

export function isBoardSize(value: number): value is BoardSize {
  return Number.isInteger(value) && value >= MIN_BOARD_SIZE && value <= MAX_BOARD_SIZE
}

export function totalTiles(boardSize: number = DEFAULT_BOARD_SIZE): number {
  return boardSize * boardSize
}

export function maxMinesForBoard(boardSize: number = DEFAULT_BOARD_SIZE): number {
  return totalTiles(boardSize) - 1
}

export function normalizeBoardSize(boardSize: number): BoardSize {
  if (!isBoardSize(boardSize)) {
    throw new Error(`boardSize must be in ${MIN_BOARD_SIZE}..${MAX_BOARD_SIZE}, got ${boardSize}`)
  }
  return boardSize
}

/**
 * Returns a set of mine tile indices (0-based) using a Fisher-Yates shuffle
 * driven by crypto.randomInt (cryptographically secure, equivalent to Kotlin's
 * SecureRandom).
 */
export function generateMinePositions(mines: number, boardSize: number = DEFAULT_BOARD_SIZE): Set<number> {
  const size = normalizeBoardSize(boardSize)
  const total = totalTiles(size)
  const max = maxMinesForBoard(size)
  if (!Number.isInteger(mines) || mines < 1 || mines > max) {
    throw new Error(`mines must be in 1..${max} for a ${size}x${size} board, got ${mines}`)
  }

  const indices = Array.from({ length: total }, (_, i) => i)
  for (let i = total - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const tmp = indices[i]
    indices[i] = indices[j]
    indices[j] = tmp
  }
  return new Set(indices.slice(0, mines))
}

export function mineChancePercentage(boardSize: number = DEFAULT_BOARD_SIZE, mines: number): number {
  return (mines / totalTiles(boardSize)) * 100
}

export function safeChancePercentage(boardSize: number = DEFAULT_BOARD_SIZE, mines: number): number {
  return 100 - mineChancePercentage(boardSize, mines)
}

/** Probability that the next pick is safe after `revealed` safe picks. */
export function safeProbability(mines: number, revealed: number, boardSize: number = DEFAULT_BOARD_SIZE): number {
  const total = totalTiles(boardSize)
  return (total - mines - revealed) / (total - revealed)
}

/** Multiplier after `revealed` safe picks. */
export function multiplierAt(mines: number, revealed: number, boardSize: number = DEFAULT_BOARD_SIZE): number {
  let survival = 1
  for (let i = 0; i < revealed; i++) {
    survival *= safeProbability(mines, i, boardSize)
  }
  return HOUSE_EDGE / survival
}

export function potentialWin(bet: number, mines: number, revealed: number, boardSize: number = DEFAULT_BOARD_SIZE): number {
  return bet * multiplierAt(mines, revealed, boardSize)
}