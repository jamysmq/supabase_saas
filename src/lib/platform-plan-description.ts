const MONTHLY_PRICE_SUFFIX =
  /\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*\/\s*m[eê]s\.?\s*$/i

function formatBRLFromCents(amountCents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(amountCents / 100)
    .replace(/\u00a0/g, ' ')
}

export function syncMonthlyPriceInPlanDescription(
  description: string | null | undefined,
  amountCents: number
) {
  const baseDescription = String(description ?? '')
    .trim()
    .replace(MONTHLY_PRICE_SUFFIX, '')
    .trim()
  const sentence = baseDescription && !/[.!?]$/.test(baseDescription)
    ? `${baseDescription}.`
    : baseDescription
  const price = `${formatBRLFromCents(amountCents)}/mês.`

  return sentence ? `${sentence} ${price}` : price
}
