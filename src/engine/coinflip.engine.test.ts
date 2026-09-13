import { describe, expect, it } from 'vitest'
import { generateCoinFlip, getStreakMultiplier, getStreakPayout } from './coinflip.engine'

describe('CoinFlipEngine', () => {
  it('streak multipliers compound correctly with 1.96x', () => {
    expect(getStreakMultiplier(0)).toBe(1.0)
    expect(getStreakMultiplier(1)).toBe(1.96)
    expect(getStreakMultiplier(2)).toBe(3.84) // 1.96^2 = 3.8416
    expect(getStreakMultiplier(3)).toBe(7.53) // 1.96^3 = 7.5295
  })

  it('calculates payout accurately', () => {
    expect(getStreakPayout(10, 1)).toBe(19.6)
    expect(getStreakPayout(10, 2)).toBe(38.4)
  })

  it('generates deterministic flips', () => {
    const flip1 = generateCoinFlip('server-a', 'client-a', 1)
    const flip2 = generateCoinFlip('server-a', 'client-a', 1)
    const flip3 = generateCoinFlip('server-a', 'client-a', 2)

    expect(flip1).toBe(flip2)
    expect(['HEADS', 'TAILS']).toContain(flip1)
    expect(['HEADS', 'TAILS']).toContain(flip3)
  })
})
