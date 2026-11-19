import type { Currency, Zone } from '../types'

export interface ZoneInfo {
  id: Zone
  /** Devise proposée par défaut pour une nouvelle page de site dans cette zone. */
  defaultCurrency: Currency
}

/** Les quatre zones commerciales. Le libellé traduit est `zone.<id>` dans les textes. */
export const ZONES: ZoneInfo[] = [
  { id: 'EMEA', defaultCurrency: 'EUR' },
  { id: 'LATAM', defaultCurrency: 'BRL' },
  { id: 'APAC', defaultCurrency: 'AUD' },
  { id: 'NOAM', defaultCurrency: 'USD' },
]

export const DEFAULT_ZONE: Zone = 'EMEA'

export function isZone(v: unknown): v is Zone {
  return ZONES.some((z) => z.id === v)
}

export function zoneInfo(zone: Zone): ZoneInfo {
  return ZONES.find((z) => z.id === zone) ?? ZONES[0]
}
