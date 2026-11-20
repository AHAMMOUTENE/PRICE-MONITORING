import type { Currency, Zone } from '../types'

export interface ZoneInfo {
  id: Zone
  /** Devise proposée par défaut pour une nouvelle page de site dans cette zone. */
  defaultCurrency: Currency
  /** Devises des pays de la zone : les colonnes de prix du catalogue sont groupées ainsi. */
  currencies: Currency[]
}

/** Les quatre zones commerciales. Le libellé traduit est `zone.<id>` dans les textes. */
export const ZONES: ZoneInfo[] = [
  { id: 'EMEA', defaultCurrency: 'EUR', currencies: ['EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'ZAR', 'AED', 'SAR', 'ILS', 'EGP', 'MAD'] },
  { id: 'LATAM', defaultCurrency: 'BRL', currencies: ['BRL', 'MXN', 'CLP', 'COP', 'PEN', 'ARS', 'UYU'] },
  { id: 'APAC', defaultCurrency: 'AUD', currencies: ['AUD', 'NZD', 'JPY', 'KRW', 'CNY', 'HKD', 'TWD', 'SGD', 'INR', 'THB', 'MYR', 'IDR', 'PHP', 'VND'] },
  { id: 'NOAM', defaultCurrency: 'USD', currencies: ['USD', 'CAD'] },
]

export const DEFAULT_ZONE: Zone = 'EMEA'

export function isZone(v: unknown): v is Zone {
  return ZONES.some((z) => z.id === v)
}

export function zoneInfo(zone: Zone): ZoneInfo {
  return ZONES.find((z) => z.id === zone) ?? ZONES[0]
}
