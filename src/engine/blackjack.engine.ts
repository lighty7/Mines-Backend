import { createHmac, randomBytes } from 'node:crypto'

export type Suit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS'
export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'A'

export interface Card {
  rank: Rank
  suit: Suit
}

export interface HandScore {
  score: number
  isSoft: boolean
  isBust: boolean
  isBlackjack: boolean
}

export const SUITS: Suit[] = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS']
export const RANKS: Rank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
]

/**
 * Creates a standard 52-card deck
 */
export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

/**
 * Creates and shuffles a 6-deck shoe deterministically with HMAC-SHA256
 */
export function createShuffledShoe(
  serverSeed: string,
  clientSeed: string,
  nonce: number = 0,
  deckCount: number = 6
): Card[] {
  const shoe: Card[] = []
  for (let d = 0; d < deckCount; d++) {
    shoe.push(...createDeck())
  }

  // Fisher-Yates shuffle with HMAC-SHA256 PRNG
  for (let i = shoe.length - 1; i > 0; i--) {
    const hmac = createHmac('sha256', serverSeed)
    hmac.update(`${clientSeed}:${nonce}:${i}`)
    const hash = hmac.digest('hex')
    const j = Number.parseInt(hash.slice(0, 8), 16) % (i + 1)

    const tmp = shoe[i]
    shoe[i] = shoe[j]
    shoe[j] = tmp
  }

  return shoe
}

/**
 * Evaluates hand score handling Aces as 11 or 1
 */
export function calculateHandScore(cards: Card[]): HandScore {
  let score = 0
  let aces = 0

  for (const card of cards) {
    if (card.rank === 'A') {
      aces++
      score += 11
    } else if (['K', 'Q', 'J', '10'].includes(card.rank)) {
      score += 10
    } else {
      score += Number.parseInt(card.rank, 10)
    }
  }

  let isSoft = false
  while (score > 21 && aces > 0) {
    score -= 10
    aces--
  }

  // Soft hand if at least one Ace remains valued at 11
  if (aces > 0 && score <= 21) {
    isSoft = true
  }

  const isBust = score > 21
  const isBlackjack = cards.length === 2 && score === 21

  return {
    score,
    isSoft,
    isBust,
    isBlackjack,
  }
}

/**
 * Dealer AI: hits on < 17, stands on all 17s (hard or soft)
 */
export function playDealerHand(
  dealerCards: Card[],
  shoe: Card[]
): { finalCards: Card[]; finalScore: HandScore; remainingShoe: Card[] } {
  const cards = [...dealerCards]
  const currentShoe = [...shoe]

  let score = calculateHandScore(cards)
  while (score.score < 17) {
    const nextCard = currentShoe.shift()
    if (!nextCard) break
    cards.push(nextCard)
    score = calculateHandScore(cards)
  }

  return {
    finalCards: cards,
    finalScore: score,
    remainingShoe: currentShoe,
  }
}
