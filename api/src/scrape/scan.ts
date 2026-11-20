/**
 * Un scan = un passage sur toutes les pages des comptes suivis d'une zone.
 *   createScan  : fige la liste des pages à visiter (scan + scan_sites) ;
 *   runScan     : visite les pages en parallèle, lit les produits, les rapproche du catalogue, évalue les remises ;
 *   tickScheduler : lance les scans planifiés (jour de scan du calendrier, heure locale de la zone), une seule fois par jour.
 * Chaque page est indépendante : un site en échec n'arrête pas les autres.
 */
import type { Db, Sql } from '../db.ts'
import { HttpError, addDays, isoWeekday, mondayOf, pool, zoneNow } from '../util.ts'
import { evaluate } from './evaluate.ts'
import { extractJsonLd, extractShopify, isShopifyPage, mergeListings, nextPageUrl, priceMentions, type LlmExtractor, type RawListing } from './extract.ts'
import type { Fetcher, FetchOptions } from './fetcher.ts'
import type { Mailer } from '../mail.ts'
import { sendScanRecaps } from '../recap.ts'
import { checkCanCreate, limitsFromEnv, ScanGuard } from './guard.ts'
import { CatalogIndex, listingKey, looksLikeVeja, type AliasIndex, type CatalogEntry } from './match.ts'

export interface ScanDeps {
  db: Db
  fetcher: Fetcher | null
  llm?: LlmExtractor | null
  /** E-mail de récapitulatif après chaque scan, pour les personnes qui l'ont activé. Absent : rien n'est envoyé. */
  mailer?: Mailer | null
  env?: Record<string, string | undefined>
  log?: (event: string, data?: Record<string, unknown>) => void
  now?: () => Date
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)

// ───────────────────────── Création ─────────────────────────

export async function createScan(
  deps: ScanDeps,
  zone: string,
  opts: { trigger: 'manual' | 'scheduled'; requestedBy?: string; scheduledFor?: string; salePeriodId?: string; force?: boolean },
): Promise<{ id: string; sites: number } | null> {
  const { db } = deps
  return db.tx(async (q) => {
    const [z] = await q.query<{ timezone: string }>('select timezone from zones where id = $1', [zone])
    if (!z) throw new HttpError(404, 'zone-unknown')
    // Garde-fous : interrupteur, délai minimum entre scans, plafond quotidien. Un déclenchement planifié refusé est simplement ignoré.
    const refused = await checkCanCreate(q, limitsFromEnv(deps.env ?? {}), zone)
    if (refused) {
      if (opts.trigger === 'scheduled') {
        deps.log?.('scan-refused', { zone, reason: refused })
        return null
      }
      throw new HttpError(refused === 'scans-disabled' ? 503 : 429, refused)
    }
    const busy = await q.query('select 1 from scans where zone_id = $1 and status in (\'queued\', \'running\') limit 1', [zone])
    if (busy.length) {
      if (opts.trigger === 'scheduled') return null
      throw new HttpError(409, 'scan-running')
    }
    const local = zoneNow(z.timezone, deps.now?.())
    const week = mondayOf(local.date)
    const inserted = await q.query<{ id: string }>(
      `insert into scans (zone_id, trigger_kind, scheduled_for, week_of, sale_period_id, requested_by)
       values ($1, $2::scan_trigger, $3::date, $4::date, $5, $6)
       on conflict (zone_id, scheduled_for) where trigger_kind = 'scheduled' do nothing
       returning id`,
      [zone, opts.trigger, opts.scheduledFor ?? null, week, opts.salePeriodId ?? null, opts.requestedBy ?? null],
    )
    if (!inserted.length) return null // déjà planifié aujourd'hui
    const id = inserted[0].id
    const sites = await q.query(
      // Une page visitée avec succès depuis peu n'entre pas dans le scan (elle ne serait pas payée deux fois), sauf si l'on force.
      `insert into scan_sites (scan_id, zone_id, site_id, account_id)
       select $1, s.zone_id, s.id, s.account_id
       from account_sites s join accounts a on a.id = s.account_id
       where s.zone_id = $2 and s.enabled and a.status = 'active' and a.tracked
         and ($3::boolean or not exists (select 1 from scan_sites x where x.site_id = s.id and x.status = 'ok' and x.finished_at > now() - ($4 || ' hours')::interval))
       returning id`,
      [id, zone, Boolean(opts.force), String(limitsFromEnv(deps.env ?? {}).siteCooldownHours)],
    )
    await q.query('update scans set sites_total = $2 where id = $1', [id, sites.length])
    return { id, sites: sites.length }
  })
}

// ───────────────────────── Exécution ─────────────────────────

interface SiteRow {
  scan_site_id: string
  site_id: string
  account_id: string
  url: string
  currency: string
  platform: string | null
  fetch_options: Record<string, any>
  excluded: boolean
}
interface ProductRow {
  id: string
  sku: string
  model: string
  material: string
  color: string
  ean: string | null
  season: string
  max_discount_pct: number | null
}

function optionsOf(o: Record<string, any>): FetchOptions & { maxPages?: number } {
  return {
    renderJs: o.renderJs ?? o.render_js,
    premiumProxy: o.premiumProxy ?? o.premium_proxy,
    countryCode: o.countryCode ?? o.country_code,
    wait: o.wait ?? o.wait_for,
    maxPages: o.maxPages,
  }
}

export async function runScan(deps: ScanDeps, scanId: string): Promise<void> {
  const { db } = deps
  const log = deps.log ?? (() => {})
  const env = deps.env ?? {}
  // Prise en charge atomique : si deux processus voient le même scan en attente, un seul le démarre.
  const [scan] = await db.query<{ zone_id: string; week_of: string }>("update scans set status = 'running', started_at = now() where id = $1 and status = 'queued' returning zone_id, week_of::text as week_of", [scanId])
  if (!scan) return
  const zone = scan.zone_id
  try {
    if (!deps.fetcher) throw new Error('scraping-not-configured')
    const products = await db.query<ProductRow>(
      "select id, sku, model, material, color, ean, season, max_discount_pct::float8 as max_discount_pct from products where zone_id = $1 and status = 'active'",
      [zone],
    )
    const priceRows = await db.query<{ product_id: string; currency: string; amount: number }>(
      "select product_id, currency::text as currency, amount::float8 as amount from product_prices where zone_id = $1 and kind = 'rrp'",
      [zone],
    )
    const rrp = new Map(priceRows.map((p) => [`${p.product_id}|${p.currency}`, p.amount]))
    const byId = new Map(products.map((p) => [p.id, p]))
    const index = new CatalogIndex(products.map<CatalogEntry>((p) => ({ id: p.id, sku: p.sku, model: p.model, material: p.material, color: p.color, ean: p.ean ?? undefined })))
    const aliases = await loadAliases(db, zone)
    const sites = await db.query<SiteRow>(
      `select ss.id as scan_site_id, s.id as site_id, s.account_id, s.url, s.currency::text as currency, s.platform, s.fetch_options, a.excluded
       from scan_sites ss join account_sites s on s.id = ss.site_id join accounts a on a.id = ss.account_id
       where ss.scan_id = $1 and ss.status = 'pending' order by a.name, s.position`,
      [scanId],
    )
    const guard = new ScanGuard(db, limitsFromEnv(env), zone)
    let stopReason: string | null = null
    await pool(sites, num(env.SCAN_CONCURRENCY, 4), async (site) => {
      const reason = await guard.blocked()
      if (reason) {
        stopReason ??= reason
        await db.query("update scan_sites set status = 'skipped', finished_at = now(), error = $2 where id = $1", [site.scan_site_id, reason])
        await db.query('update scans set sites_done = sites_done + 1 where id = $1', [scanId])
        return
      }
      const ok = await runSite(deps, { scanId, zone, weekOf: scan.week_of }, site, { index, byId, rrp, aliases, guard })
      guard.recordSite(ok)
      await db.query(`update scans set sites_done = sites_done + $2, sites_failed = sites_failed + $3 where id = $1`, [scanId, ok ? 1 : 0, ok ? 0 : 1])
    })
    const [t] = await db.query<{ total: number; failed: number }>('select sites_total as total, sites_failed as failed from scans where id = $1', [scanId])
    const status = t.total > 0 && t.failed === t.total && !stopReason ? 'failed' : t.failed > 0 || stopReason ? 'partial' : 'done'
    if (stopReason) await db.query('update scans set error = $2 where id = $1', [scanId, `arrêté : ${stopReason}`])
    await db.query(
      `update scans set status = $2::scan_status, finished_at = now(),
         credits_used = coalesce((select sum(credits_used) from scan_sites where scan_id = $1), 0),
         listings_seen = coalesce((select sum(listings_seen) from scan_sites where scan_id = $1), 0),
         cost_estimate = (select sum(cost) from scan_sites where scan_id = $1) where id = $1`,
      [scanId, status],
    )
    await db.query('refresh materialized view weekly_listing_state').catch((e) => log('refresh-failed', { error: String(e) }))
    log('scan-finished', { scanId, zone, status })
    // Récapitulatif par e-mail (opt-in). Un scan en échec total n'a rien à recommander : pas d'e-mail.
    if (status !== 'failed') await sendScanRecaps(db, deps.mailer, zone, scanId, env.APP_URL || 'http://127.0.0.1:5173', log, env.DEFAULT_ZONE_ROLE ?? 'editor').catch((e) => log('recap-failed', { error: String(e) }))
  } catch (e) {
    await db.query("update scans set status = 'failed', finished_at = now(), error = $2 where id = $1", [scanId, String(e instanceof Error ? e.message : e).slice(0, 500)])
    log('scan-error', { scanId, error: String(e) })
  }
}

async function loadAliases(db: Sql, zone: string): Promise<AliasIndex> {
  const rows = await db.query<{ site_id: string | null; kind: string; value: string; verdict: 'product' | 'not-veja'; product_id: string | null }>(
    'select site_id, kind::text as kind, value, verdict::text as verdict, product_id from product_aliases where zone_id = $1',
    [zone],
  )
  const map = new Map(rows.map((r) => [`${r.kind}|${r.value}|${r.site_id ?? '*'}`, { verdict: r.verdict, productId: r.product_id ?? undefined }]))
  return { get: (kind, value, siteId) => map.get(`${kind}|${value}|${siteId}`) ?? map.get(`${kind}|${value}|*`) }
}

interface Ctx {
  index: CatalogIndex
  byId: Map<string, ProductRow>
  rrp: Map<string, number>
  aliases: AliasIndex
  guard: ScanGuard
}

/** Visite une page de site. Renvoie vrai si la collecte a réussi (même sans produit). */
async function runSite(deps: ScanDeps, scan: { scanId: string; zone: string; weekOf: string }, site: SiteRow, ctx: Ctx): Promise<boolean> {
  const { db, fetcher } = deps
  const env = deps.env ?? {}
  const log = deps.log ?? (() => {})
  const creditUsd = Number(env.SCRAPINGBEE_CREDIT_USD) || 0.0002
  await db.query("update scan_sites set status = 'running', started_at = now() where id = $1", [site.scan_site_id])
  let credits = 0
  let llmCost = 0
  let pages = 0
  let httpStatus: number | undefined
  const requestIds: string[] = []
  try {
    const opts = optionsOf(site.fetch_options ?? {})
    const maxPages = opts.maxPages ?? num(env.SCAN_MAX_PAGES, 8)
    const get = async (url: string, o: FetchOptions) => {
      if (credits >= ctx.guard.limits.creditsPerSite) throw new Error('site-credit-limit')
      ctx.guard.fetches++
      const r = await fetcher!.fetch(url, o)
      credits += r.credits
      pages++
      httpStatus = r.status
      if (r.requestId) requestIds.push(r.requestId)
      return r
    }
    let raw: RawListing[] = []
    let isShopify = site.platform === 'shopify'
    let level = 0 // échelle de coût atteinte pour cette page
    let startLevel = 0

    if (isShopify) raw = await collectShopify(site.url, maxPages, (u) => get(u, { ...opts, renderJs: false }))
    if (!raw.length) {
      // Collecte générique, par échelle de coût croissant : 0 page simple (1 crédit) · 1 rendu JavaScript (5) · 2 proxy premium (25).
      // On ne monte d'un cran que si la page est refusée (protection anti-robot) ou ne donne aucun produit.
      const ladder = (lv: number): FetchOptions => ({ ...opts, renderJs: lv >= 1 || opts.renderJs === true, premiumProxy: lv >= 2 || opts.premiumProxy === true })
      startLevel = opts.premiumProxy ? 2 : opts.renderJs ? 1 : 0
      level = startLevel
      const refused = (r: { status: number; body: string }) => !r.body || (r.status >= 400 && r.status !== 404 && r.status !== 410)
      /** Lecture des produits d'une page : données structurées, complétées par Claude quand elles sont trop pauvres. */
      const read = async (body: string, pageUrl: string): Promise<RawListing[]> => {
        let found = extractJsonLd(body, pageUrl)
        const mentions = priceMentions(body)
        // Un produit affiche un ou deux prix : bien moins de produits que prévu = extraction incomplète.
        const weak = found.length === 0 || (mentions >= 8 && found.length < mentions * 0.3)
        if (weak && deps.llm && ctx.guard.llmCalls < ctx.guard.limits.maxLlmCallsPerScan) {
          ctx.guard.llmCalls++
          const r = await deps.llm.extract(body, pageUrl).catch((e) => {
            log('llm-failed', { site: site.url, error: String(e) })
            return { listings: [] as RawListing[], costUsd: 0 }
          })
          llmCost += r.costUsd
          found = mergeListings(found, r.listings)
        }
        return found
      }
      const seen = new Set<string>()
      let url: string | undefined = site.url
      for (let page = 1; url && page <= maxPages && !seen.has(url); page++) {
        seen.add(url)
        let res = await get(url, ladder(level))
        while (refused(res) && level < 2) res = await get(url, ladder(++level))
        if (refused(res)) {
          if (page === 1) throw new Error(`HTTP ${res.status}`)
          break
        }
        if (page === 1 && isShopifyPage(res.body)) isShopify = true
        let found = await read(res.body, url)
        // Page 1 sans aucun produit : page de blocage ou contenu chargé en différé. On monte d'un cran.
        while (page === 1 && found.length === 0 && level < 2) {
          res = await get(url, ladder(++level))
          if (refused(res)) continue
          found = await read(res.body, url)
        }
        const before = raw.length
        raw = mergeListings(raw, found)
        if (raw.length === before) break
        url = nextPageUrl(res.body, url)
      }
    }
    const stats = await db.tx((q) => persist(q, scan, site, ctx, raw))
    // Mémorise ce qui a marché : les prochains scans iront droit au but (moins de crédits).
    const patch: Record<string, unknown> = {}
    if (raw.length > 0 && level > startLevel) {
      patch.renderJs = true
      if (level >= 2) patch.premiumProxy = true
    }
    await db.query(
      `update account_sites set fetch_options = fetch_options || $2::text::jsonb, platform = coalesce(platform, $3) where id = $1`,
      [site.site_id, JSON.stringify(patch), isShopify ? 'shopify' : null],
    )
    await db.query(
      `update scan_sites set status = $2::scan_site_status, finished_at = now(), pages_fetched = $3, http_status = $4, credits_used = $5, cost = $6,
         listings_seen = $7, listings_matched = $8, listings_to_review = $9,
         provider_request_ids = array(select jsonb_array_elements_text($10::text::jsonb)) where id = $1`,
      [site.scan_site_id, raw.length ? 'ok' : 'empty', pages, httpStatus ?? null, credits, credits * creditUsd + llmCost, stats.seen, stats.matched, stats.toReview, JSON.stringify(requestIds)],
    )
    return true
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e).slice(0, 300)
    log('site-failed', { site: site.url, error: message })
    await db.query(
      "update scan_sites set status = 'failed', finished_at = now(), error = $2, pages_fetched = $3, http_status = $4, credits_used = $5, cost = $6 where id = $1",
      [site.scan_site_id, message, pages, httpStatus ?? null, credits, credits * creditUsd + llmCost],
    )
    return false
  }
}

/** Boutique Shopify : /collections/xxx/products.json renvoie prix, prix barré, SKU et EAN sans analyser de HTML. */
async function collectShopify(pageUrl: string, maxPages: number, get: (url: string) => Promise<{ status: number; body: string }>): Promise<RawListing[]> {
  let u: URL
  try {
    u = new URL(pageUrl)
  } catch {
    return []
  }
  const base = u.pathname.replace(/\/+$/, '').replace(/\/products\.json$/, '')
  const out: RawListing[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await get(`${u.origin}${base}/products.json?limit=250&page=${page}`)
    if (res.status >= 400) break
    const items = extractShopify(res.body, u.origin)
    if (!items.length) break
    out.push(...items)
    if (items.length < 250) break
  }
  return out
}

async function persist(q: Sql, scan: { scanId: string; zone: string; weekOf: string }, site: SiteRow, ctx: Ctx, raw: RawListing[]) {
  let seen = 0
  let matched = 0
  let toReview = 0
  const done = new Set<string>()
  for (const l of raw) {
    if (!(l.price > 0)) continue
    const key = listingKey(l)
    if (done.has(key)) continue
    done.add(key)
    const m = ctx.index.match(l, site.site_id, ctx.aliases)
    if (m.skip) continue
    if (m.kind === 'none' && !looksLikeVeja(l)) continue // autre marque
    const [row] = await q.query<{ id: string; status: string; product_id: string | null; proof: string; candidate_product_id: string | null }>(
      `insert into listings (zone_id, site_id, account_id, url_key, url, title, image_url, retailer_ref, ean, product_id, proof, candidate_product_id, candidate_confidence, match_kind)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::proof_kind, $12, $13, $14::match_kind)
       on conflict (site_id, url_key) do update set
         url = excluded.url, title = excluded.title, image_url = coalesce(excluded.image_url, listings.image_url),
         retailer_ref = coalesce(excluded.retailer_ref, listings.retailer_ref), ean = coalesce(excluded.ean, listings.ean),
         last_seen_at = now(),
         status = case when listings.status = 'dismissed' then 'dismissed'::listing_status else 'active'::listing_status end,
         product_id = case when listings.match_kind = 'alias' then listings.product_id else excluded.product_id end,
         proof = case when listings.match_kind = 'alias' then listings.proof else excluded.proof end,
         candidate_product_id = case when listings.match_kind = 'alias' then listings.candidate_product_id else excluded.candidate_product_id end,
         candidate_confidence = case when listings.match_kind = 'alias' then listings.candidate_confidence else excluded.candidate_confidence end,
         match_kind = case when listings.match_kind = 'alias' then listings.match_kind else excluded.match_kind end
       returning id, status::text as status, product_id, proof::text as proof, candidate_product_id`,
      [scan.zone, site.site_id, site.account_id, key, l.url, l.title.slice(0, 500), l.image ?? null, l.ref ?? null, l.ean ?? null, m.productId ?? null, m.proof, m.candidateId ?? null, m.candidateId ? m.confidence : null, m.kind],
    )
    if (row.status === 'dismissed') continue
    seen++
    row.proof === 'confirmed' ? matched++ : toReview++
    const [obs] = await q.query<{ id: string }>(
      `insert into observations (zone_id, listing_id, account_id, site_id, scan_id, scan_site_id, week_of, currency, price, original_price, title, url, image_url, in_stock, raw)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13, $14, $15::text::jsonb)
       on conflict (scan_site_id, listing_id) do nothing returning id`,
      [scan.zone, row.id, site.account_id, site.site_id, scan.scanId, site.scan_site_id, scan.weekOf, site.currency, l.price, l.originalPrice ?? null, l.title.slice(0, 500), l.url, l.image ?? null, l.inStock ?? null, JSON.stringify({ ref: l.ref, ean: l.ean, brand: l.brand, pageCurrency: l.currency })],
    )
    if (!obs) continue
    await writeEvaluation(q, ctx, { observationId: obs.id, zone: scan.zone, productId: row.product_id ?? row.candidate_product_id, proof: row.proof as 'confirmed' | 'to-review', price: l.price, currency: site.currency, excluded: site.excluded, cause: 'scan' })
  }
  return { seen, matched, toReview }
}

/** Écrit l'évaluation d'un relevé, figée avec les valeurs du moment (SKU, RRP, règle). Clôt la précédente. */
export async function writeEvaluation(
  q: Sql,
  ctx: Pick<Ctx, 'byId' | 'rrp'>,
  e: { observationId: string; zone: string; productId: string | null; proof: 'confirmed' | 'to-review'; price: number; currency: string; excluded: boolean; cause: 'scan' | 'decision' | 'manual'; decisionId?: string },
): Promise<void> {
  const p = e.productId ? ctx.byId.get(e.productId) : undefined
  const rrp = p ? ctx.rrp.get(`${p.id}|${e.currency}`) : undefined
  const rule = p?.max_discount_pct ?? undefined
  const r = evaluate({ price: e.price, hasProduct: Boolean(p), rrp, rulePct: rule })
  await q.query("update observation_evaluations set is_current = false, superseded_at = now() where observation_id = $1 and is_current", [e.observationId])
  await q.query(
    `insert into observation_evaluations (observation_id, zone_id, cause, decision_id, product_id, sku, proof, rrp, rule_pct, discount_pct, reason, evaluation, account_excluded)
     values ($1, $2, $3::evaluation_cause, $4, $5, $6, $7::proof_kind, $8, $9, $10, $11::anomaly_reason, $12::evaluation_kind, $13)`,
    [e.observationId, e.zone, e.cause, e.decisionId ?? null, p?.id ?? null, p?.sku ?? null, e.proof, r.evaluation === 'rrp-missing' || r.evaluation === 'unidentified' ? null : rrp ?? null, rule ?? null, r.discountPct, r.reason ?? null, r.evaluation, e.excluded],
  )
}

/** Lit le catalogue d'une zone pour réévaluer (décisions humaines). */
export async function loadEvalContext(q: Sql, zone: string): Promise<Pick<Ctx, 'byId' | 'rrp'>> {
  const products = await q.query<ProductRow>("select id, sku, model, material, color, ean, season, max_discount_pct::float8 as max_discount_pct from products where zone_id = $1", [zone])
  const prices = await q.query<{ product_id: string; currency: string; amount: number }>("select product_id, currency::text as currency, amount::float8 as amount from product_prices where zone_id = $1 and kind = 'rrp'", [zone])
  return { byId: new Map(products.map((p) => [p.id, p])), rrp: new Map(prices.map((p) => [`${p.product_id}|${p.currency}`, p.amount])) }
}

// ───────────────────────── Planification ─────────────────────────

/** Plan de scan d'un jour : celui de la période de soldes qui le couvre, sinon le rythme habituel de la zone (le lundi par défaut). */
export function planFor(date: string, periods: { id: string; start_on: string; end_on: string; scan_mode: string; scan_days: number[] | null }[], defaultDays: number[] = [1]): { scan: boolean; periodId?: string } {
  const p = periods.find((x) => x.start_on <= date && date <= x.end_on)
  if (!p) return { scan: defaultDays.includes(isoWeekday(date)) }
  return { scan: p.scan_mode === 'daily' || (p.scan_days ?? []).includes(isoWeekday(date)), periodId: p.id }
}

/**
 * À appeler chaque minute. Pour chaque zone : si c'est un jour de scan et que l'heure locale de scan est passée,
 * crée le scan du jour (une seule fois grâce à l'index unique) et le lance. Renvoie les scans lancés.
 */
export async function tickScheduler(deps: ScanDeps, run: (p: Promise<void>) => void = (p) => void p): Promise<string[]> {
  const zones = await deps.db.query<{ id: string; timezone: string; scan_time: string; default_scan_days: number[]; upd_date: string; upd_time: string }>(
    `select id, timezone, to_char(scan_time, 'HH24:MI') as scan_time, default_scan_days,
            to_char(updated_at at time zone timezone, 'YYYY-MM-DD') as upd_date, to_char(updated_at at time zone timezone, 'HH24:MI') as upd_time
     from zones`,
  )
  const started: string[] = []
  for (const z of zones) {
    const local = zoneNow(z.timezone, deps.now?.())
    if (local.time < z.scan_time) continue
    // Réglage modifié aujourd'hui après l'heure choisie : le scan de ce jour est considéré comme passé (pas de lancement surprise).
    if (z.upd_date === local.date && z.upd_time > z.scan_time) continue
    const periods = await deps.db.query<{ id: string; start_on: string; end_on: string; scan_mode: string; scan_days: number[] | null }>(
      'select id, start_on::text as start_on, end_on::text as end_on, scan_mode::text as scan_mode, scan_days from sale_periods where zone_id = $1 and end_on >= $2::date',
      [z.id, addDays(local.date, -1)],
    )
    const plan = planFor(local.date, periods, z.default_scan_days ?? [1])
    if (!plan.scan) continue
    const created = await createScan(deps, z.id, { trigger: 'scheduled', scheduledFor: local.date, salePeriodId: plan.periodId })
    if (created && created.sites > 0) {
      started.push(created.id)
      run(runScan(deps, created.id))
    } else if (created) await deps.db.query("update scans set status = 'done', started_at = now(), finished_at = now() where id = $1", [created.id])
  }
  return started
}

/** Scans « en cours » depuis trop longtemps (processus arrêté) : marqués en échec, leurs pages en cours aussi. */
export async function recoverStale(deps: ScanDeps, minutes = 25): Promise<void> {
  const stale = await deps.db.query<{ id: string }>(
    "update scans set status = 'failed', finished_at = now(), error = 'interrompu (délai dépassé)' where status = 'running' and started_at < now() - ($1 || ' minutes')::interval returning id",
    [String(minutes)],
  )
  for (const s of stale) await deps.db.query("update scan_sites set status = 'failed', finished_at = now(), error = 'interrompu' where scan_id = $1 and status in ('pending', 'running')", [s.id])
}

/** Lance les scans en attente (manuels, ou créés par le planificateur) ; rend la main quand ils sont finis. */
export async function runQueued(deps: ScanDeps): Promise<number> {
  const queued = await deps.db.query<{ id: string }>("select id from scans where status = 'queued' order by created_at")
  await Promise.all(queued.map((s) => runScan(deps, s.id)))
  return queued.length
}

/** Au démarrage : un scan « en cours » dont le processus s'est arrêté est marqué en échec ; ceux en attente sont relancés. */
export async function recoverScans(deps: ScanDeps, run: (p: Promise<void>) => void = (p) => void p): Promise<void> {
  await deps.db.query("update scans set status = 'failed', finished_at = now(), error = 'interrompu (redémarrage du serveur)' where status = 'running'")
  const queued = await deps.db.query<{ id: string }>("select id from scans where status = 'queued' order by created_at")
  for (const s of queued) run(runScan(deps, s.id))
}
