import type { ScanPlan } from '../types'

const DAY = 86_400_000

/** Jour ISO (1 = lundi … 7 = dimanche) d'une date « AAAA-MM-JJ ». */
export function isoWeekday(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay()
  return d === 0 ? 7 : d
}

/** Un scan a-t-il lieu ce jour-là selon le plan ? */
export function isScanDay(iso: string, plan: ScanPlan): boolean {
  return plan.mode === 'daily' || plan.days.includes(isoWeekday(iso))
}

/** Nombre de jours de scan entre deux dates incluses. */
export function countScanDays(start: string, end: string, plan: ScanPlan): number {
  const from = Date.parse(start + 'T00:00:00Z')
  const to = Date.parse(end + 'T00:00:00Z')
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0
  let n = 0
  for (let t = from; t <= to; t += DAY) {
    if (isScanDay(new Date(t).toISOString().slice(0, 10), plan)) n++
  }
  return n
}
