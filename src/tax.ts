import { z } from 'zod'

export const VAT_RATE = 0.075 // 7.5% Nigerian standard VAT

export type WhtCategory =
  | 'contracts_supplies'
  | 'consultancy_professional'
  | 'construction'
  | 'rent'
  | 'dividends_interest'

export const WHT_RATES: Record<WhtCategory, { rate: number; label: string }> = {
  contracts_supplies: { rate: 0.05, label: 'Contracts & Supplies (5%)' },
  consultancy_professional: { rate: 0.1, label: 'Professional & Consultancy (10%)' },
  construction: { rate: 0.05, label: 'Construction Contracts (5%)' },
  rent: { rate: 0.1, label: 'Rent & Leases (10%)' },
  dividends_interest: { rate: 0.1, label: 'Dividends & Royalties (10%)' },
}

export type CompanyScale = 'small' | 'medium' | 'large'

export const CIT_RATES: Record<CompanyScale, { rate: number; threshold: string; label: string }> = {
  small: { rate: 0.0, threshold: '< NGN 25m turnover', label: 'Small Business Exemption (0%)' },
  medium: { rate: 0.2, threshold: 'NGN 25m – 100m turnover', label: 'Medium Company Rate (20%)' },
  large: { rate: 0.3, threshold: '> NGN 100m turnover', label: 'Large Company Rate (30%)' },
}

const positiveFinite = z.number().finite().nonnegative()

export function calculateVAT(baseAmount: number, inclusive = false): {
  baseAmount: number
  vatAmount: number
  totalAmount: number
  effectiveRate: number
} {
  positiveFinite.parse(baseAmount)
  if (inclusive) {
    // totalAmount = baseAmount; netBase = total / 1.075
    const netBase = Math.round((baseAmount / (1 + VAT_RATE)) * 100) / 100
    const vat = Math.round((baseAmount - netBase) * 100) / 100
    return {
      baseAmount: netBase,
      vatAmount: vat,
      totalAmount: baseAmount,
      effectiveRate: VAT_RATE,
    }
  }
  const vat = Math.round(baseAmount * VAT_RATE * 100) / 100
  const total = Math.round((baseAmount + vat) * 100) / 100
  return {
    baseAmount,
    vatAmount: vat,
    totalAmount: total,
    effectiveRate: VAT_RATE,
  }
}

export function calculateWHT(grossInvoiceAmount: number, category: WhtCategory): {
  grossAmount: number
  category: WhtCategory
  categoryLabel: string
  whtRate: number
  whtDeducted: number
  netPayable: number
} {
  positiveFinite.parse(grossInvoiceAmount)
  const config = WHT_RATES[category]
  if (!config) throw new Error(`Unknown WHT category: ${category}`)
  const wht = Math.round(grossInvoiceAmount * config.rate * 100) / 100
  const net = Math.round((grossInvoiceAmount - wht) * 100) / 100
  return {
    grossAmount: grossInvoiceAmount,
    category,
    categoryLabel: config.label,
    whtRate: config.rate,
    whtDeducted: wht,
    netPayable: net,
  }
}

export function determineCompanyScale(annualTurnover: number): CompanyScale {
  positiveFinite.parse(annualTurnover)
  if (annualTurnover < 25_000_000) return 'small'
  if (annualTurnover <= 100_000_000) return 'medium'
  return 'large'
}

export function calculateCIT(annualTurnover: number, taxableProfit: number): {
  annualTurnover: number
  taxableProfit: number
  scale: CompanyScale
  citRate: number
  citPayable: number
  label: string
} {
  positiveFinite.parse(annualTurnover)
  positiveFinite.parse(taxableProfit)
  const scale = determineCompanyScale(annualTurnover)
  const { rate, label } = CIT_RATES[scale]
  const cit = Math.round(taxableProfit * rate * 100) / 100
  return {
    annualTurnover,
    taxableProfit,
    scale,
    citRate: rate,
    citPayable: cit,
    label,
  }
}
