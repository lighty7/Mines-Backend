import { describe, expect, it } from 'vitest'
import { env } from '../config/env'
import { adminService } from './admin.service'

describe('AdminService', () => {
  it('logs in successfully with the master admin secret key', async () => {
    const result = await adminService.login({ key: env.ADMIN_SECRET_KEY })
    expect(result.token).toBeDefined()
    expect(result.admin.role).toBe('ADMIN')
  })

  it('rejects invalid admin key', async () => {
    await expect(adminService.login({ key: 'wrong-key-12345' })).rejects.toThrow(
      /Please provide a valid Admin Key or Credentials/
    )
  })

  it('fetches system stats with mainPot and player counts', async () => {
    const stats = await adminService.getStats()
    expect(typeof stats.mainPot).toBe('number')
    expect(typeof stats.totalUsersCount).toBe('number')
    expect(typeof stats.activePlayersCount).toBe('number')
    expect(typeof stats.houseProfit).toBe('number')
    expect(Array.isArray(stats.activeRounds)).toBe(true)
  })
})
