import { createHmac } from 'node:crypto'

export type CoinSide = 'HEADS' | 'TAILS'

export const COIN_RTP = 0.98 // 98% RTP
export const FLIP_MULTIPLIER_STEP = 1.96 // 0.98 / 0.5 = 1.96x per flip

/**
 * Calculates compounding multiplier for a streak of k successful flips
 */
export function getStreakMultiplier(streak: number): number {
  if (streak <= 0) return 1.0
  const mult = Math.pow(FLIP_MULTIPLIER_STEP, streak)
  return Math.round(mult * 100) / 100
}

/**
 * Calculates potential payout
 */
export function getStreakPayout(bet: number, streak: number): number {
  return Math.round(bet * getStreakMultiplier(streak) * 100) / 100
}

/**
 * Generates deterministic coin flip outcome from HMAC-SHA256
 */
export function generateCoinFlip(serverSeed: string, clientSeed: string, nonce: number): CoinSide {
  const hmac = createHmac('sha256', serverSeed)
  hmac.update(`${clientSeed}:${nonce}`)
  const hash = hmac.digest('hex')

  // First byte: even = HEADS, odd = TAILS
  const byte = Number.parseInt(hash.slice(0, 2), 16)
  return byte % 2 === 0 ? 'HEADS' : 'TAILS'
}
