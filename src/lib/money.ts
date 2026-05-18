export function formatCurrencyFromCents(valueCents: number | null | undefined) {
  if (valueCents === null || valueCents === undefined) return '-'

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valueCents / 100)
}

export function formatMoneyInput(value: string) {
  const amount = parseMoneyToNumber(value)

  if (!Number.isFinite(amount)) {
    return ''
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount)
}

export function formatCentsAsMoneyInput(valueCents: number | null | undefined) {
  if (valueCents === null || valueCents === undefined) return ''
  return formatCurrencyFromCents(valueCents)
}

export function parseMoneyToNumber(value: unknown) {
  const raw = String(value ?? '').trim()

  if (!raw) return NaN

  const normalized = raw
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')

  return Number(normalized)
}

export function parseMoneyToCents(value: unknown) {
  const amount = parseMoneyToNumber(value)

  if (!Number.isFinite(amount)) {
    return NaN
  }

  return Math.round(amount * 100)
}
