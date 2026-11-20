/**
 * Garde-fous contre l'emballement : ScrapingBee et Claude se paient à l'appel, et un hébergeur qui relance les
 * tâches en boucle (ou un bug) ne doit jamais pouvoir vider le compte. Les compteurs viennent de la base
 * (pas de la mémoire du processus), donc ils tiennent même si le Worker redémarre à chaque minute.
 *
 * Ce qui est limité :
 *  - interrupteur général (SCANS_ENABLED=false) ;
 *  - plafonds de crédits par jour et par mois (global, et par zone si zones.credits_budget_month est renseigné) et de dépense par jour ;
 *  - délai minimum entre deux scans d'une zone, nombre maximal de scans par jour, délai minimum avant de revisiter un site ;
 *  - par scan : durée, nombre d'appels, appels Claude, échecs consécutifs (coupe-circuit) ;
 *  - par site : crédits dépensés.
 * Un site écarté par un garde-fou passe en « ignoré » avec la raison ; le scan est alors « partiel ». Rien n'est relancé tout seul.
 */
import type { Db } from '../db.ts'

export interface Limits {
  enabled: boolean
  creditsPerDay: number
  creditsPerMonth: number
  costUsdPerDay: number
  creditsPerSite: number
  scansPerZonePerDay: number
  scanCooldownMin: number
  siteCooldownHours: number
  maxConsecutiveFailures: number
  scanMaxMinutes: number
  maxFetchesPerScan: number
  maxLlmCallsPerScan: number
}

const n = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d)

export function limitsFromEnv(env: Record<string, string | undefined>): Limits {
  return {
    enabled: (env.SCANS_ENABLED ?? 'true').toLowerCase() !== 'false',
    creditsPerDay: n(env.MAX_CREDITS_PER_DAY, 5_000),
    creditsPerMonth: n(env.MAX_CREDITS_PER_MONTH, 60_000),
    costUsdPerDay: n(env.MAX_COST_USD_PER_DAY, 10),
    creditsPerSite: n(env.MAX_CREDITS_PER_SITE, 150),
    scansPerZonePerDay: n(env.MAX_SCANS_PER_ZONE_PER_DAY, 6),
    scanCooldownMin: n(env.SCAN_COOLDOWN_MINUTES, 30),
    siteCooldownHours: n(env.SITE_COOLDOWN_HOURS, 6),
    maxConsecutiveFailures: n(env.MAX_CONSECUTIVE_FAILURES, 8),
    scanMaxMinutes: n(env.SCAN_MAX_MINUTES, 20),
    maxFetchesPerScan: n(env.MAX_FETCHES_PER_SCAN, 2_000),
    maxLlmCallsPerScan: n(env.MAX_LLM_CALLS_PER_SCAN, 60),
  }
}

/** Refus à la création d'un scan (code court, repris tel quel par l'API). */
export async function checkCanCreate(db: { query: Db['query'] }, limits: Limits, zone: string): Promise<string | null> {
  if (!limits.enabled) return 'scans-disabled'
  const [r] = await db.query<{ recent: number; today: number }>(
    `select count(*) filter (where created_at > now() - ($2 || ' minutes')::interval and (credits_used > 0 or status in ('queued', 'running')))::int as recent,
            count(*) filter (where created_at > now() - interval '24 hours')::int as today
     from scans where zone_id = $1`,
    [zone, String(limits.scanCooldownMin)],
  )
  if (limits.scanCooldownMin > 0 && r.recent > 0) return 'scan-too-soon'
  if (r.today >= limits.scansPerZonePerDay) return 'scan-daily-limit'
  return null
}

/** Suivi d'un scan en cours : décide, avant chaque site, si on a encore le droit de dépenser. */
export class ScanGuard {
  fetches = 0
  llmCalls = 0
  private failures = 0
  private reason: string | null = null
  private startedAt = Date.now()

  constructor(
    private db: Pick<Db, 'query'>,
    public limits: Limits,
    private zone: string,
  ) {}

  recordSite(ok: boolean): void {
    this.failures = ok ? 0 : this.failures + 1
  }

  /** Raison d'arrêt, ou null. Une fois levée, elle reste valable pour tout le scan. */
  async blocked(): Promise<string | null> {
    if (this.reason) return this.reason
    const l = this.limits
    if (!l.enabled) return (this.reason = 'scans-disabled')
    if (Date.now() - this.startedAt > l.scanMaxMinutes * 60_000) return (this.reason = 'scan-deadline')
    if (this.fetches >= l.maxFetchesPerScan) return (this.reason = 'scan-fetch-limit')
    if (l.maxConsecutiveFailures > 0 && this.failures >= l.maxConsecutiveFailures) return (this.reason = 'circuit-open')
    const [u] = await this.db.query<{ day: number; month: number; cost: number; zone_month: number; zone_budget: number | null }>(
      `select coalesce(sum(credits_used) filter (where started_at >= date_trunc('day', now())), 0)::float8 as day,
              coalesce(sum(credits_used) filter (where started_at >= date_trunc('month', now())), 0)::float8 as month,
              coalesce(sum(cost) filter (where started_at >= date_trunc('day', now())), 0)::float8 as cost,
              coalesce(sum(credits_used) filter (where started_at >= date_trunc('month', now()) and zone_id = $1), 0)::float8 as zone_month,
              (select credits_budget_month from zones where id = $1) as zone_budget
       from scan_sites where started_at >= date_trunc('month', now())`,
      [this.zone],
    )
    if (u.day >= l.creditsPerDay) return (this.reason = 'budget-daily')
    if (u.cost >= l.costUsdPerDay) return (this.reason = 'budget-cost-daily')
    if (u.month >= l.creditsPerMonth) return (this.reason = 'budget-monthly')
    if (u.zone_budget !== null && u.zone_month >= u.zone_budget) return (this.reason = 'budget-zone-monthly')
    return null
  }
}
