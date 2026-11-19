export const SKU_RE = /^[A-Z0-9]{9}$/

/** Date et heure locales d'un fuseau : { date: 'AAAA-MM-JJ', time: 'HH:MM' }. */
export function zoneNow(timeZone: string, now: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Jour ISO (1 = lundi … 7 = dimanche). */
export function isoWeekday(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay()
  return d === 0 ? 7 : d
}

export function mondayOf(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso))
}

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503,
    message: string,
  ) {
    super(message)
  }
}

export const round1 = (n: number) => Math.round(n * 10) / 10

/** Exécute `fn` sur les éléments avec au plus `limit` tâches en parallèle. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
