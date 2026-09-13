import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  calculateHandScore,
  createShuffledShoe,
  playDealerHand,
  Card,
} from '../engine/blackjack.engine'
import { ApiError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { assertPositive, requiredDecimal } from '../utils/money'
import { WalletService } from './wallet.service'

const wallet = new WalletService()

export interface DealInput {
  userId: string
  bet: number
  clientSeed?: string
  idempotencyKey?: string
}

export class BlackjackService {
  async deal(input: DealInput) {
    const player = await prisma.user.findUnique({ where: { id: input.userId } })
    if (!player) throw new NotFoundError('Player not found')
    if (player.isBanned) {
      throw new ForbiddenError(
        player.bannedReason ? `Account suspended: ${player.bannedReason}` : 'Account is suspended'
      )
    }

    const bet = requiredDecimal(input.bet)
    assertPositive(bet, 'bet')

    const serverSeed = randomBytes(32).toString('hex')
    const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
    const clientSeed = input.clientSeed?.trim() || 'default-client-seed'

    const userRoundsCount = await prisma.blackjackRound.count({ where: { userId: input.userId } })
    const nonce = userRoundsCount + 1

    const shoe = createShuffledShoe(serverSeed, clientSeed, nonce)

    // Deal: Player 2 cards, Dealer 2 cards
    const playerCards: Card[] = [shoe.shift()!, shoe.shift()!]
    const dealerCards: Card[] = [shoe.shift()!, shoe.shift()!]

    const playerScore = calculateHandScore(playerCards)
    const dealerScore = calculateHandScore(dealerCards)

    let status: 'ACTIVE' | 'WON' | 'LOST' | 'PUSH' = 'ACTIVE'
    let payout = new Prisma.Decimal(0)

    // Check immediate Natural Blackjack (pays 3:2)
    if (playerScore.isBlackjack) {
      if (dealerScore.isBlackjack) {
        status = 'PUSH'
        payout = bet // Return bet
      } else {
        status = 'WON'
        payout = bet.mul(2.5).toDP(8) // 3:2 payout: Bet + 1.5x bet
      }
    }

    return prisma.$transaction(async (tx) => {
      // 1. Debit initial bet
      await wallet.debit(tx, input.userId, bet, {
        type: 'BET',
        idempotencyKey: input.idempotencyKey,
      })

      // 2. Create round
      const round = await tx.blackjackRound.create({
        data: {
          userId: input.userId,
          bet,
          playerHands: [{ cards: playerCards, bet: Number(bet), score: playerScore.score }] as any,
          dealerHand: {
            cards: dealerCards,
            hidden: status === 'ACTIVE',
            score: status === 'ACTIVE' ? calculateHandScore([dealerCards[0]]).score : dealerScore.score,
          } as any,
          status,
          payout,
          serverSeed,
          serverSeedHash,
          clientSeed,
        },
      })

      // 3. Credit payout if already resolved (Blackjack)
      let finalBalance = await this.getUserBalance(tx, input.userId)
      if (payout.greaterThan(0)) {
        finalBalance = await wallet.credit(tx, input.userId, payout, {
          type: 'WIN',
          roundId: round.id,
        })
      }

      // Hide dealer's second card if active
      const visibleDealerCards =
        status === 'ACTIVE' ? [dealerCards[0], { rank: '?', suit: 'SPADES' }] : dealerCards

      return {
        roundId: round.id,
        bet: bet.toNumber(),
        playerCards,
        playerScore,
        dealerCards: visibleDealerCards,
        dealerScore: status === 'ACTIVE' ? calculateHandScore([dealerCards[0]]) : dealerScore,
        status,
        payout: payout.toNumber(),
        balance: finalBalance.toNumber(),
        serverSeedHash,
      }
    })
  }

  async hit(userId: string, roundId: string) {
    return prisma.$transaction(async (tx) => {
      const round = await tx.blackjackRound.findUnique({ where: { id: roundId } })
      if (!round) throw new NotFoundError('Round not found')
      if (round.userId !== userId) throw new ForbiddenError('This round belongs to another user')
      if (round.status !== 'ACTIVE') throw new ConflictError('Round is already finished')

      const playerHands = (round.playerHands as any[]) || []
      const hand = playerHands[0]
      const dealerHand = round.dealerHand as any

      // Regenerate shoe sequence up to current cards drawn
      const shoe = createShuffledShoe(round.serverSeed, round.clientSeed, 0)
      const usedCardsCount = hand.cards.length + dealerHand.cards.length
      const nextCard = shoe[usedCardsCount]

      const updatedPlayerCards = [...hand.cards, nextCard]
      const score = calculateHandScore(updatedPlayerCards)

      let status: 'ACTIVE' | 'WON' | 'LOST' | 'PUSH' = 'ACTIVE'
      if (score.isBust) {
        status = 'LOST'
      }

      await tx.blackjackRound.update({
        where: { id: roundId },
        data: {
          playerHands: [{ cards: updatedPlayerCards, bet: Number(round.bet), score: score.score }],
          dealerHand: {
            ...dealerHand,
            hidden: status === 'ACTIVE',
          },
          status,
        },
      })

      const balance = await this.getUserBalance(tx, userId)
      const visibleDealerCards =
        status === 'ACTIVE'
          ? [dealerHand.cards[0], { rank: '?', suit: 'SPADES' }]
          : dealerHand.cards

      return {
        roundId,
        playerCards: updatedPlayerCards,
        playerScore: score,
        dealerCards: visibleDealerCards,
        dealerScore:
          status === 'ACTIVE'
            ? calculateHandScore([dealerHand.cards[0]])
            : calculateHandScore(dealerHand.cards),
        status,
        payout: 0,
        balance: balance.toNumber(),
      }
    })
  }

  async stand(userId: string, roundId: string) {
    return prisma.$transaction(async (tx) => {
      const round = await tx.blackjackRound.findUnique({ where: { id: roundId } })
      if (!round) throw new NotFoundError('Round not found')
      if (round.userId !== userId) throw new ForbiddenError('This round belongs to another user')
      if (round.status !== 'ACTIVE') throw new ConflictError('Round is already finished')

      const playerHands = (round.playerHands as any[]) || []
      const hand = playerHands[0]
      const dealerHand = round.dealerHand as any

      const shoe = createShuffledShoe(round.serverSeed, round.clientSeed, 0)
      const usedCardsCount = hand.cards.length + dealerHand.cards.length
      const remainingShoe = shoe.slice(usedCardsCount)

      // Dealer plays out hand
      const dealerResult = playDealerHand(dealerHand.cards, remainingShoe)
      const playerScore = calculateHandScore(hand.cards)
      const dealerScore = dealerResult.finalScore

      let status: 'ACTIVE' | 'WON' | 'LOST' | 'PUSH' = 'LOST'
      let payout = new Prisma.Decimal(0)
      const bet = new Prisma.Decimal(round.bet)

      if (dealerScore.isBust) {
        // Dealer busts: Player wins 1:1 (2x return)
        status = 'WON'
        payout = bet.mul(2).toDP(8)
      } else if (playerScore.score > dealerScore.score) {
        // Player higher: Player wins 1:1 (2x return)
        status = 'WON'
        payout = bet.mul(2).toDP(8)
      } else if (playerScore.score === dealerScore.score) {
        // Tie: Push (1x return)
        status = 'PUSH'
        payout = bet
      } else {
        // Dealer higher: Player loses
        status = 'LOST'
        payout = new Prisma.Decimal(0)
      }

      // Credit payout if won or push
      let finalBalance = await this.getUserBalance(tx, userId)
      if (payout.greaterThan(0)) {
        finalBalance = await wallet.credit(tx, userId, payout, {
          type: 'WIN',
          roundId,
        })
      }

      await tx.blackjackRound.update({
        where: { id: roundId },
        data: {
          dealerHand: {
            cards: dealerResult.finalCards,
            hidden: false,
            score: dealerScore.score,
          } as any,
          status,
          payout,
        },
      })

      return {
        roundId,
        playerCards: hand.cards,
        playerScore,
        dealerCards: dealerResult.finalCards,
        dealerScore,
        status,
        payout: payout.toNumber(),
        balance: finalBalance.toNumber(),
      }
    })
  }

  async double(userId: string, roundId: string) {
    return prisma.$transaction(async (tx) => {
      const round = await tx.blackjackRound.findUnique({ where: { id: roundId } })
      if (!round) throw new NotFoundError('Round not found')
      if (round.userId !== userId) throw new ForbiddenError('This round belongs to another user')
      if (round.status !== 'ACTIVE') throw new ConflictError('Round is already finished')

      const playerHands = (round.playerHands as any[]) || []
      const hand = playerHands[0]
      if (hand.cards.length !== 2) throw new ApiError(400, 'Can only double down on first 2 cards')

      const originalBet = new Prisma.Decimal(round.bet)

      // Debit additional bet
      await wallet.debit(tx, userId, originalBet, {
        type: 'BET',
        roundId,
      })

      const totalBet = originalBet.mul(2)

      const dealerHand = (round.dealerHand as any) || { cards: [] }
      const shoe = createShuffledShoe(round.serverSeed, round.clientSeed, 0)
      const usedCardsCount = hand.cards.length + dealerHand.cards.length
      const nextCard = shoe[usedCardsCount]

      const updatedPlayerCards = [...hand.cards, nextCard]
      const playerScore = calculateHandScore(updatedPlayerCards)

      let status: 'ACTIVE' | 'WON' | 'LOST' | 'PUSH' = 'LOST'
      let payout = new Prisma.Decimal(0)
      let finalDealerCards = dealerHand.cards
      let dealerScore = calculateHandScore(finalDealerCards)

      if (playerScore.isBust) {
        status = 'LOST'
      } else {
        // Dealer plays out
        const remainingShoe = shoe.slice(usedCardsCount + 1)
        const dealerResult = playDealerHand(dealerHand.cards, remainingShoe)
        finalDealerCards = dealerResult.finalCards
        dealerScore = dealerResult.finalScore

        if (dealerScore.isBust || playerScore.score > dealerScore.score) {
          status = 'WON'
          payout = totalBet.mul(2).toDP(8)
        } else if (playerScore.score === dealerScore.score) {
          status = 'PUSH'
          payout = totalBet
        }
      }

      let finalBalance = await this.getUserBalance(tx, userId)
      if (payout.greaterThan(0)) {
        finalBalance = await wallet.credit(tx, userId, payout, {
          type: 'WIN',
          roundId,
        })
      }

      await tx.blackjackRound.update({
        where: { id: roundId },
        data: {
          bet: totalBet,
          playerHands: [{ cards: updatedPlayerCards, bet: Number(totalBet), score: playerScore.score }],
          dealerHand: {
            cards: finalDealerCards,
            hidden: false,
            score: dealerScore.score,
          } as any,
          status,
          payout,
        },
      })

      return {
        roundId,
        playerCards: updatedPlayerCards,
        playerScore,
        dealerCards: finalDealerCards,
        dealerScore,
        status,
        payout: payout.toNumber(),
        balance: finalBalance.toNumber(),
      }
    })
  }

  async getHistory(userId: string, limit = 20) {
    const rounds = await prisma.blackjackRound.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        bet: true,
        payout: true,
        status: true,
        playerHands: true,
        dealerHand: true,
        createdAt: true,
      },
    })

    return rounds.map((r) => ({
      id: r.id,
      bet: r.bet.toNumber(),
      payout: r.payout.toNumber(),
      status: r.status,
      playerHands: r.playerHands,
      dealerHand: r.dealerHand,
      createdAt: r.createdAt,
    }))
  }

  private async getUserBalance(tx: Prisma.TransactionClient, userId: string): Promise<Prisma.Decimal> {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })
    return u.balance
  }
}

export const blackjackService = new BlackjackService()
