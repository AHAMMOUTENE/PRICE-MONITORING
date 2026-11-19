import type { Currency } from '../types'
import { intlLocale } from './format'

/**
 * Devises proposées dans les listes (codes ISO 4217). Toute devise reste acceptée par les données :
 * une devise absente d'ici s'affiche quand même avec son code.
 */
export const CURRENCIES: Currency[] = [
  'EUR', 'GBP', 'USD', 'CAD', 'BRL', 'AUD', 'KRW', 'MXN',
  'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'ZAR', 'AED', 'SAR', 'ILS', 'EGP', 'MAD',
  'JPY', 'CNY', 'HKD', 'TWD', 'SGD', 'NZD', 'INR', 'THB', 'MYR', 'IDR', 'PHP', 'VND',
  'CLP', 'COP', 'PEN', 'ARS', 'UYU',
]

export const isCurrencyCode = (v: string): boolean => /^[A-Z]{3}$/.test(v)

const TLD_CURRENCY: Record<string, Currency> = {
  uk: 'GBP', 'co.uk': 'GBP', ie: 'EUR', fr: 'EUR', de: 'EUR', nl: 'EUR', be: 'EUR', it: 'EUR', es: 'EUR', pt: 'EUR', at: 'EUR', fi: 'EUR', lu: 'EUR',
  ch: 'CHF', se: 'SEK', no: 'NOK', dk: 'DKK', pl: 'PLN', cz: 'CZK', us: 'USD', ca: 'CAD', au: 'AUD', nz: 'NZD', br: 'BRL', mx: 'MXN', kr: 'KRW', jp: 'JPY', hk: 'HKD', sg: 'SGD',
}
const PATH_CURRENCY: Record<string, Currency> = { uk: 'GBP', gb: 'GBP', us: 'USD', au: 'AUD', ca: 'CAD', fr: 'EUR', de: 'EUR', nl: 'EUR', it: 'EUR', es: 'EUR', eu: 'EUR', ch: 'CHF', br: 'BRL', mx: 'MXN', kr: 'KRW', jp: 'JPY' }

/**
 * Devise probable d'une page d'après son adresse (« .co.uk » → GBP, « /au/ » → AUD), à confirmer par l'utilisateur.
 * Sans indice, la devise proposée par la zone.
 */
export function currencyFromUrl(url: string, fallback: Currency): Currency {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const parts = host.split('.')
    const last2 = parts.slice(-2).join('.')
    if (TLD_CURRENCY[last2]) return TLD_CURRENCY[last2]
    const tld = parts[parts.length - 1]
    if (TLD_CURRENCY[tld]) return TLD_CURRENCY[tld]
    const seg = u.pathname.toLowerCase().split('/').filter(Boolean)[0] ?? ''
    const code = seg.split('-')[0]
    if (PATH_CURRENCY[seg]) return PATH_CURRENCY[seg]
    if (/^[a-z]{2}-[a-z]{2}$/.test(seg) && PATH_CURRENCY[seg.split('-')[1]]) return PATH_CURRENCY[seg.split('-')[1]]
    if (PATH_CURRENCY[code]) return PATH_CURRENCY[code]
  } catch {
    /* adresse illisible : on garde la devise de la zone */
  }
  return fallback
}

const nameCache = new Map<string, Intl.DisplayNames>()

/** Nom de la devise dans la langue de l'interface (« Euro », « Livre sterling »). */
export function currencyName(code: Currency): string {
  const locale = intlLocale()
  let names = nameCache.get(locale)
  if (!names) {
    names = new Intl.DisplayNames(locale, { type: 'currency' })
    nameCache.set(locale, names)
  }
  try {
    return names.of(code) ?? code
  } catch {
    return code
  }
}
