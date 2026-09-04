import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(10000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((s) => s.startsWith('postgresql://') || s.startsWith('postgres://'), {
      message: 'DATABASE_URL must be a postgres connection string',
    }),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment variables — see errors above')
}

export const env = parsed.data
export type Env = typeof env