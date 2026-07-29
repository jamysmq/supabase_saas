export const pixKeyTypes = ['cpf', 'cnpj', 'email', 'phone', 'random'] as const

export type PixKeyType = (typeof pixKeyTypes)[number]

type StaticPixPayloadInput = {
  key: string
  keyType: PixKeyType
  merchantName: string
  merchantCity: string
  amountCents?: number
  txid?: string
}

function tlv(id: string, value: string) {
  if (value.length > 99) {
    throw new Error(`O campo ${id} excede o limite do BR Code.`)
  }

  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function hasRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value)
}

function isValidCpf(value: string) {
  if (value.length !== 11 || hasRepeatedDigits(value)) return false

  const calculateDigit = (length: number) => {
    let sum = 0

    for (let index = 0; index < length; index += 1) {
      sum += Number(value[index]) * (length + 1 - index)
    }

    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }

  return calculateDigit(9) === Number(value[9]) && calculateDigit(10) === Number(value[10])
}

function isValidNumericCnpj(value: string) {
  if (value.length !== 14 || hasRepeatedDigits(value)) return false

  const calculateDigit = (base: string, weights: number[]) => {
    const sum = base
      .split('')
      .reduce((total, digit, index) => total + Number(digit) * weights[index], 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }

  const first = calculateDigit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = calculateDigit(`${value.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])

  return value.endsWith(`${first}${second}`)
}

function normalizePhone(value: string) {
  const trimmed = value.trim()

  if (trimmed.startsWith('+')) {
    return `+${onlyDigits(trimmed)}`
  }

  const digits = onlyDigits(trimmed)
  return digits.startsWith('55') ? `+${digits}` : `+55${digits}`
}

export function normalizePixKey(value: string, keyType: PixKeyType) {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error('Informe a chave Pix.')
  }

  if (keyType === 'cpf') {
    const digits = onlyDigits(trimmed)
    if (!isValidCpf(digits)) throw new Error('Informe um CPF válido para a chave Pix.')
    return digits
  }

  if (keyType === 'cnpj') {
    const compact = trimmed.replace(/[.\-/\s]/g, '').toUpperCase()
    const validNumeric = /^\d{14}$/.test(compact) && isValidNumericCnpj(compact)
    const validAlphanumeric = /^[A-Z0-9]{12}\d{2}$/.test(compact) && /[A-Z]/.test(compact)

    if (!validNumeric && !validAlphanumeric) {
      throw new Error('Informe um CNPJ válido para a chave Pix.')
    }

    return compact
  }

  if (keyType === 'email') {
    const email = trimmed.toLowerCase()
    if (
      email.length > 77 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[\x20-\x7E]+$/.test(email)
    ) {
      throw new Error('Informe um e-mail válido para a chave Pix.')
    }
    return email
  }

  if (keyType === 'phone') {
    const phone = normalizePhone(trimmed)
    if (!/^\+\d{10,15}$/.test(phone)) {
      throw new Error('Informe o telefone Pix com DDI e DDD.')
    }
    return phone
  }

  const randomKey = trimmed.toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(randomKey)) {
    throw new Error('Informe uma chave Pix aleatória válida.')
  }
  return randomKey
}

function normalizeMerchantText(value: string, maximumLength: number, uppercase = false) {
  const normalized = value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const result = uppercase ? normalized.toUpperCase() : normalized

  if (!result) {
    throw new Error('Informe os dados do beneficiário do Pix.')
  }

  return result.slice(0, maximumLength)
}

function normalizeTxid(value?: string) {
  if (!value) return '***'

  const txid = value.replace(/[^A-Za-z0-9]/g, '').slice(0, 25)
  if (!txid) throw new Error('A referência Pix é inválida.')
  return txid
}

export function calculatePixCrc(payloadWithoutCrc: string) {
  let crc = 0xffff

  for (let index = 0; index < payloadWithoutCrc.length; index += 1) {
    crc ^= payloadWithoutCrc.charCodeAt(index) << 8

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function createStaticPixPayload(input: StaticPixPayloadInput) {
  const key = normalizePixKey(input.key, input.keyType)
  const merchantName = normalizeMerchantText(input.merchantName, 25)
  const merchantCity = normalizeMerchantText(input.merchantCity, 15, true)
  const txid = normalizeTxid(input.txid)

  if (input.amountCents !== undefined && (!Number.isInteger(input.amountCents) || input.amountCents <= 0)) {
    throw new Error('O valor da cobrança é inválido.')
  }

  const merchantAccount = tlv('00', 'br.gov.bcb.pix') + tlv('01', key)
  const amount = input.amountCents === undefined
    ? ''
    : tlv('54', (input.amountCents / 100).toFixed(2))

  const payloadWithoutCrc = [
    tlv('00', '01'),
    tlv('26', merchantAccount),
    tlv('52', '0000'),
    tlv('53', '986'),
    amount,
    tlv('58', 'BR'),
    tlv('59', merchantName),
    tlv('60', merchantCity),
    tlv('62', tlv('05', txid)),
    '6304',
  ].join('')

  return `${payloadWithoutCrc}${calculatePixCrc(payloadWithoutCrc)}`
}
