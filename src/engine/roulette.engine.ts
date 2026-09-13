import { createHmac } from 'node:crypto'

export type RouletteColor = 'RED' | 'BLACK' | 'GREEN'

export type RouletteBetType =
  | 'STRAIGHT'
  | 'SPLIT'
  | 'STREET'
  | 'CORNER'
  | 'SIX_LINE'
  | 'COLUMN'
  | 'DOZEN'
  | 'RED'
  | 'BLACK'
  | 'EVEN'
  | 'ODD'
  | 'LOW'
  | 'HIGH'

export interface PlacedBet {
  type: RouletteBetType
  numbers: number[] // winning numbers for this bet
  amount: number
}

export interface EvaluatedBet extends PlacedBet {
  won: boolean
  payout: number
  multiplier: number
}

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
])

export const BLACK_NUMBERS = new Set([
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
])

// European Roulette Wheel Number Sequence (clockwise)
export const WHEEL_NUMBERS: number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]

export function getNumberColor(num: number): RouletteColor {
  if (num === 0) return 'GREEN'
  return RED_NUMBERS.has(num) ? 'RED' : 'BLACK'
}

/**
 * Multiplier returned on win (e.g. Straight pays 35:1 profit + 1:1 original bet = 36x)
 */
export const BET_MULTIPLIERS: Record<RouletteBetType, number> = {
  STRAIGHT: 36,
  SPLIT: 18,
  STREET: 12,
  CORNER: 9,
  SIX_LINE: 6,
  COLUMN: 3,
  DOZEN: 3,
  RED: 2,
  BLACK: 2,
  EVEN: 2,
  ODD: 2,
  LOW: 2,
  HIGH: 2,
}

/**
 * Deterministically generates winning roulette number (0-36) from HMAC-SHA256
 */
export function generateRouletteNumber(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): number {
  const hmac = createHmac('sha256', serverSeed)
  hmac.update(`${clientSeed}:${nonce}`)
  const hash = hmac.digest('hex')

  const intVal = Number.parseInt(hash.slice(0, 8), 16)
  return intVal % 37
}

/**
 * Evaluates placed bets against the winning number
 */
export function evaluateRouletteBets(
  bets: PlacedBet[],
  winningNumber: number
): { evaluatedBets: EvaluatedBet[]; totalPayout: number } {
  let totalPayout = 0

  const evaluatedBets: EvaluatedBet[] = bets.map((b) => {
    const won = b.numbers.includes(winningNumber)
    const mult = won ? BET_MULTIPLIERS[b.type] || 0 : 0
    const payout = won ? Math.round(b.amount * mult * 100) / 100 : 0

    if (won) totalPayout += payout

    return {
      ...b,
      won,
      payout,
      multiplier: mult,
    }
  })

  return {
    evaluatedBets,
    totalPayout: Math.round(totalPayout * 100) / 100,
  }
}
