import { createApp } from './app'
import { env } from './config/env'
import { prisma } from './lib/prisma'

async function main() {
  await prisma.$connect()
  // eslint-disable-next-line no-console
  console.log('Connected to PostgreSQL')

  const app = createApp()
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Mines backend listening on :${env.PORT} (${env.NODE_ENV})`)
  })
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start Mines backend:', error)
  process.exit(1)
})