import type { Currency } from '../types'

export type Locale = 'fr' | 'en' | 'pt' | 'es'

/** Locale Intl utilisée pour chaque langue de l'interface. */
const INTL: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB', pt: 'pt-BR', es: 'es-ES' }

let active: Locale = 'fr'

/** Appelé par le fournisseur de langue : tous les formats suivent la langue choisie. */
export function setActiveLocale(l: Locale): void {
  active = l
}
export function getLocale(): Locale {
  return active
}
export function intlLocale(l: Locale = active): string {
  return INTL[l]
}

const moneyCache = new Map<string, Intl.NumberFormat>()

export function formatMoney(amount: number, currency: Currency): string {
  const key = `${active}:${currency}`
  let f = moneyCache.get(key)
  if (!f) {
    // Intl connaît les décimales de chaque devise (2 pour EUR, 0 pour KRW ou JPY).
    try {
      f = new Intl.NumberFormat(INTL[active], { style: 'currency', currency })
    } catch {
      // Devise inconnue d'Intl (saisie libre dans un fichier) : montant suivi de son code, sans jamais planter.
      const plain = new Intl.NumberFormat(INTL[active], { maximumFractionDigits: 2 })
      f = { format: (n: number) => `${plain.format(n)} ${currency}` } as Intl.NumberFormat
    }
    moneyCache.set(key, f)
  }
  return f.format(amount)
}

/** Montant court pour un axe de graphique : sans décimales quand il tombe juste. */
export function formatMoneyShort(amount: number, currency: Currency): string {
  if (Number.isInteger(amount)) {
    try {
      return new Intl.NumberFormat(INTL[active], { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)
    } catch {
      /* devise inconnue : repli ci-dessous */
    }
  }
  return formatMoney(amount, currency)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(INTL[active]).format(n)
}

/** Remise avec un vrai signe moins : « −37 % » (« −37% » en anglais). */
export function formatDiscount(pct: number): string {
  return `−${Math.round(pct)}${active === 'en' ? '' : ' '}%`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}${active === 'en' ? '' : ' '}%`
}

export function parseIso(iso: string): Date {
  return new Date(iso + 'T00:00:00Z')
}

/** « 16 nov. » */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat(INTL[active], { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parseIso(iso))
}

/** « 16 novembre 2026 » */
export function formatFullDate(iso: string): string {
  return new Intl.DateTimeFormat(INTL[active], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseIso(iso))
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
