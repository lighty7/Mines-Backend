import 'dotenv/config'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, UnauthorizedError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { AuthService } from './auth.service'

const auth = new AuthService()

describe('AuthService', () => {
  const createdIds: string[] = []

  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } })
    await prisma.$disconnect()
  })

  async function registerUnique(params: { username: string; email: string; password: string; address?: string }) {
    const n = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await auth.register({
      ...params,
      username: `${params.username}_${n}`,
      email: `${params.email.split('@')[0]}_${n}@test.dev`,
    })
    createdIds.push(result.user.id)
    return result
  }

  it('registers a user with a default balance and issues a token', async () => {
    const { user, token } = await registerUnique({ username: 'player1', email: 'player1@test.dev', password: 'secret123' })

    expect(user.username).toMatch(/^player1_/)
    expect(user.balance).toBeCloseTo(1000, 8)
    expect(token).toBeTruthy()
    expect(auth.verifyToken(token).sub).toBe(user.id)
  })

  it('rejects duplicate registration', async () => {
    const first = await registerUnique({ username: 'dup', email: 'dup@test.dev', password: 'secret123' })
    await expect(
      auth.register({ username: first.user.username, email: 'other@test.dev', password: 'secret123' }),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      auth.register({ username: 'other2', email: first.user.email.toUpperCase(), password: 'secret123' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('logs in with correct credentials and rejects wrong ones', async () => {
    const { user } = await registerUnique({ username: 'loginuser', email: 'login@test.dev', password: 'secret123' })

    const { token } = await auth.login({ email: user.email, password: 'secret123' })
    expect(token).toBeTruthy()

    await expect(
      auth.login({ email: user.email, password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(
      auth.login({ email: 'nope@test.dev', password: 'secret123' }),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('returns public profile without password hash', async () => {
    const { user } = await registerUnique({
      username: 'profile_user',
      email: 'profile@test.dev',
      password: 'secret123',
      address: '0xabc',
    })
    const me = await auth.me(user.id)

    expect(me.username).toBe(user.username)
    expect(me.address).toBe('0xabc')
    expect(me).not.toHaveProperty('passwordHash')
  })

  it('rejects a tampered or expired token', async () => {
    const { user, token } = await registerUnique({
      username: 'tok',
      email: 'tok@test.dev',
      password: 'secret123',
    })
    expect(auth.verifyToken(token).sub).toBe(user.id)
    expect(() => auth.verifyToken(`${token.slice(0, -4)}xxxx`)).toThrow(UnauthorizedError)
  })
})