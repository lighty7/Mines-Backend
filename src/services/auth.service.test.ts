import 'dotenv/config'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, UnauthorizedError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { AuthService } from './auth.service'

const auth = new AuthService()

describe('AuthService', () => {
  beforeAll(async () => {
    await prisma.$connect()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.user.deleteMany({})
  })

  it('registers a user with a default balance and issues a token', async () => {
    const { user, token } = await auth.register({
      username: 'player1',
      email: 'player1@test.dev',
      password: 'secret123',
    })

    expect(user.username).toBe('player1')
    expect(user.balance).toBeCloseTo(1000, 8)
    expect(token).toBeTruthy()
    expect(auth.verifyToken(token).sub).toBe(user.id)
  })

  it('rejects duplicate registration', async () => {
    await auth.register({ username: 'player1', email: 'a@test.dev', password: 'secret123' })
    await expect(
      auth.register({ username: 'player1', email: 'b@test.dev', password: 'secret123' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      auth.register({ username: 'other', email: 'A@TEST.DEV', password: 'secret123' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await auth.register({ username: 'player1', email: 'login@test.dev', password: 'secret123' })

    const { token } = await auth.login({ email: 'login@test.dev', password: 'secret123' })
    expect(token).toBeTruthy()

    await expect(
      auth.login({ email: 'login@test.dev', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(
      auth.login({ email: 'nope@test.dev', password: 'secret123' }),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('returns public profile without password hash', async () => {
    const { user } = await auth.register({
      username: 'profile_user',
      email: 'profile@test.dev',
      password: 'secret123',
      address: '0xabc',
    })
    const me = await auth.me(user.id)

    expect(me.username).toBe('profile_user')
    expect(me.address).toBe('0xabc')
    expect(me).not.toHaveProperty('passwordHash')
  })

  it('rejects a tampered or expired token', async () => {
    const { user, token } = await auth.register({
      username: 'tok',
      email: 'tok@test.dev',
      password: 'secret123',
    })
    expect(auth.verifyToken(token).sub).toBe(user.id)
    expect(() => auth.verifyToken(`${token.slice(0, -4)}xxxx`)).toThrow(UnauthorizedError)
  })
})