import { describe, expect, it } from 'vitest'
import {
  calculateHandScore,
  createDeck,
  createShuffledShoe,
  playDealerHand,
  Card,
} from './blackjack.engine'

describe('BlackjackEngine', () => {
  it('standard deck has 52 unique cards', () => {
    const deck = createDeck()
    expect(deck).toHaveLength(52)
  })

  it('calculates natural blackjack (Ace + 10/Face)', () => {
    const hand: Card[] = [
      { rank: 'A', suit: 'SPADES' },
      { rank: 'K', suit: 'HEARTS' },
    ]
    const res = calculateHandScore(hand)
    expect(res.score).toBe(21)
    expect(res.isBlackjack).toBe(true)
    expect(res.isBust).toBe(false)
  })

  it('handles soft and hard Aces properly', () => {
    const softHand: Card[] = [
      { rank: 'A', suit: 'SPADES' },
      { rank: '6', suit: 'HEARTS' },
    ]
    expect(calculateHandScore(softHand).score).toBe(17)
    expect(calculateHandScore(softHand).isSoft).toBe(true)

    // Drawing a 10 on soft 17 turns Ace into 1 (score 17 -> 17)
    const hardHand: Card[] = [...softHand, { rank: '10', suit: 'CLUBS' }]
    expect(calculateHandScore(hardHand).score).toBe(17)
    expect(calculateHandScore(hardHand).isSoft).toBe(false)
    expect(calculateHandScore(hardHand).isBust).toBe(false)

    // Drawing a 9 on 17 busts (score 26)
    const bustHand: Card[] = [...hardHand, { rank: '9', suit: 'DIAMONDS' }]
    expect(calculateHandScore(bustHand).score).toBe(26)
    expect(calculateHandScore(bustHand).isBust).toBe(true)
  })

  it('dealer stands on 17 or higher', () => {
    const initialDealer: Card[] = [
      { rank: '10', suit: 'SPADES' },
      { rank: '7', suit: 'HEARTS' },
    ]
    const shoe: Card[] = [{ rank: '5', suit: 'CLUBS' }]

    const result = playDealerHand(initialDealer, shoe)
    expect(result.finalCards).toHaveLength(2)
    expect(result.finalScore.score).toBe(17)
  })

  it('dealer hits on 16 or lower until 17+', () => {
    const initialDealer: Card[] = [
      { rank: '10', suit: 'SPADES' },
      { rank: '5', suit: 'HEARTS' },
    ]
    const shoe: Card[] = [
      { rank: '4', suit: 'CLUBS' }, // 10 + 5 + 4 = 19 (dealer stands)
      { rank: '2', suit: 'DIAMONDS' },
    ]

    const result = playDealerHand(initialDealer, shoe)
    expect(result.finalCards).toHaveLength(3)
    expect(result.finalScore.score).toBe(19)
    expect(result.remainingShoe).toHaveLength(1)
  })
})
