import { Prisma } from '@prisma/client'

export const DECIMAL_ZERO = new Prisma.Decimal(0)

export function toDecimal(value: number | string | Prisma.Decimal): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value
  return new Prisma.Decimal(value)
}

export function requiredDecimal(value: number | string | Prisma.Decimal): Prisma.Decimal {
  const d = toDecimal(value)
  if (!d.isFinite()) throw new Error(`Invalid number: ${value}`)
  return d
}

export function assertPositive(value: Prisma.Decimal, label = 'amount'): void {
  if (value.lte(DECIMAL_ZERO)) {
    throw new Error(`${label} must be positive`)
  }
}

export function assertNonNegative(value: Prisma.Decimal, label = 'value'): void {
  if (value.lt(DECIMAL_ZERO)) {
    throw new Error(`${label} must not be negative`)
  }
}