/**
 * État d'une zone au format que l'application consomme : comptes, catalogue, calendrier, commentaires, activité
 * et relevés (une ligne par fiche revendeur, avec 8 semaines d'historique). L'application en dérive tous ses écrans.
 * Les règles de remise sont lues en direct sur le catalogue : modifier une règle met à jour les écrans immédiatement.
 */
import { ts, type Sql } from './db.ts'
import { addDays, mondayOf, zoneNow } from './util.ts'

export const HISTORY_WEEKS = 8

export interface StateOptions {
  now?: Date
  /** Courriel de l'utilisateur, pour marquer ses commentaires. */
  userEmail: string
}

export async function fetchRetailers(q: Sql, zone: string, onlyId?: string) {
  return q.query<{ id: string; name: string; zone: string; tracked: boolean; excluded: boolean; segmentation: string; salesReps: string[]; sites: { currency: string; url: string }[] }>(
    `select a.id, a.name, a.zone_id as zone, a.tracked, a.excluded, a.segmentation, a.sales_reps as "salesReps",
       coalesce(json_agg(json_build_object('currency', s.currency::text, 'url', s.url) order by s.position, s.created_at) filter (where s.id is not null and s.enabled), '[]'::json) as sites
     from accounts a left join account_sites s on s.account_id = a.id
     where a.zone_id = $1 and a.status = 'active' and ($2::uuid is null or a.id = $2::uuid)
     group by a.id order by lower(a.name)`,
    [zone, onlyId ?? null],
  )
}

export async function buildState(q: Sql, zone: string, opts: StateOptions) {
  const [z] = await q.query<{ timezone: string; default_currency: string }>('select timezone, default_currency::text as default_currency from zones where id = $1', [zone])
  if (!z) return null
  const today = zoneNow(z.timezone, opts.now).date
  const current = mondayOf(today)
  const weeks = Array.from({ length: HISTORY_WEEKS }, (_, i) => addDays(current, (i - (HISTORY_WEEKS - 1)) * 7))

  const retailers = await fetchRetailers(q, zone)
  const excludedRetailerIds = retailers.filter((r) => r.excluded).map((r) => r.id)

  const products = await q.query<Record<string, any>>(
    `select id, sku, variants, model, material, color, dept, season, carry_over as "carryOver", max_discount_pct::float8 as "maxDiscountPct",
            segmentation, color_code as "colorCode", description, composition, origin, ean
     from products where zone_id = $1 and status = 'active' order by sku`,
    [zone],
  )
  const prices = await q.query<{ product_id: string; currency: string; kind: 'rrp' | 'wholesale'; amount: number }>(
    'select product_id, currency::text as currency, kind::text as kind, amount::float8 as amount from product_prices where zone_id = $1',
    [zone],
  )
  const byId = new Map<string, Record<string, any>>()
  const catalog = products.map((p) => {
    const { id, ...rest } = p
    const item: Record<string, any> = { ...rest, rrp: {}, wholesale: {} }
    for (const k of Object.keys(item)) if (item[k] === null) delete item[k]
    if (!item.carryOver) delete item.carryOver
    byId.set(id, item)
    return item
  })
  for (const p of prices) {
    const item = byId.get(p.product_id)
    if (item) item[p.kind][p.currency] = p.amount
  }

  // Image d'un produit : celle de sa fiche confirmée la plus récemment vue chez un retailer.
  const images = await q.query<{ product_id: string; image: string }>(
    `select distinct on (l.product_id) l.product_id, l.image_url as image from listings l
     where l.zone_id = $1 and l.product_id is not null and l.image_url is not null and l.status = 'active'
     order by l.product_id, l.last_seen_at desc`,
    [zone],
  )
  for (const im of images) {
    const item = byId.get(im.product_id)
    if (item) item.image = im.image
  }

  const periods = await q.query<{ id: string; label: string; start: string; end: string; mode: string; days: number[] | null }>(
    'select id, label, start_on::text as start, end_on::text as "end", scan_mode::text as mode, scan_days as days from sale_periods where zone_id = $1 order by start_on',
    [zone],
  )
  const comments = await q.query<{ id: string; retailerId: string; text: string; by: string; at: string; mine: boolean }>(
    `select c.id, c.account_id as "retailerId", c.body as text, c.author_name as by, ${ts('c.created_at')} as at, c.author_email = $2 as mine
     from account_comments c join accounts a on a.id = c.account_id where c.zone_id = $1 and a.status = 'active' order by c.created_at desc limit 1000`,
    [zone, opts.userEmail],
  )
  const activity = await q.query<{ id: string; at: string; kind: string; title: string; retailerName: string; by: string; note: string | null }>(
    `select id, to_char(at at time zone 'utc', 'YYYY-MM-DD') as at, kind, title, retailer_name as "retailerName", by, note
     from activity_feed where zone_id = $1 order by activity_feed.at desc limit 60`,
    [zone],
  )

  const listings = await q.query<Record<string, any>>(
    `select l.id, l.account_id as "retailerId", l.title, l.url, l.image_url as image, l.proof::text as proof,
            l.product_id as "productId", l.candidate_product_id as "candidateId", l.candidate_confidence::float8 as confidence
     from listings l join accounts a on a.id = l.account_id
     where l.zone_id = $1 and l.status = 'active' and a.status = 'active' and l.last_seen_at > now() - interval '21 days'`,
    [zone],
  )
  const weekly = await q.query<{ listing_id: string; week: string; price: number; original_price: number | null; currency: string }>(
    `select distinct on (o.listing_id, o.week_of) o.listing_id, o.week_of::text as week, o.price::float8 as price, o.original_price::float8 as original_price, o.currency::text as currency
     from observations o where o.zone_id = $1 and o.week_of >= $2::date order by o.listing_id, o.week_of, o.observed_at desc`,
    [zone, weeks[0]],
  )
  const byListing = new Map<string, typeof weekly>()
  for (const w of weekly) byListing.set(w.listing_id, [...(byListing.get(w.listing_id) ?? []), w])

  const [last] = await q.query<{ at: string; status: string }>(
    `select ${ts('finished_at')} as at, status::text as status from scans where zone_id = $1 and finished_at is not null order by finished_at desc limit 1`,
    [zone],
  )
  const [running] = await q.query<{ n: number }>("select count(*)::int as n from scans where zone_id = $1 and status in ('queued', 'running')", [zone])

  const observations = []
  for (const l of listings) {
    const rows = byListing.get(l.id)
    if (!rows?.length) continue
    const latest = rows[rows.length - 1]
    const product = byId.get(l.productId ?? '')
    const candidate = byId.get(l.candidateId ?? '')
    const ref = product ?? candidate
    const rrp = ref?.rrp?.[latest.currency] ?? 0
    const price = new Map(rows.map((r) => [r.week, r.price]))
    let last: number | undefined
    const history = weeks.map((week) => {
      const known = price.get(week)
      if (known !== undefined) last = known
      // Avant le premier relevé : au prix de référence (aucune remise inventée) ; ensuite, dernier prix connu.
      return { week, price: last ?? (rrp || rows[0].price) }
    })
    observations.push({
      id: l.id,
      retailerId: l.retailerId,
      title: l.title,
      url: l.url,
      currency: latest.currency,
      model: ref?.model ?? '',
      color: ref?.color ?? '',
      ...(product ? { sku: product.sku } : {}),
      ...(l.image ? { image: l.image } : {}),
      rrp,
      ...(latest.original_price ? { originalPrice: latest.original_price } : {}),
      history,
      proof: product ? 'confirmed' : 'to-review',
      ...(!product && candidate ? { candidate: { sku: candidate.sku, confidence: l.confidence ?? 0.5 } } : {}),
    })
  }

  return {
    zone,
    today,
    weeks,
    defaultCurrency: z.default_currency,
    retailers: retailers.map(({ excluded: _e, ...r }) => r),
    excludedRetailerIds,
    catalog,
    periods: periods.map((p) => ({ id: p.id, zone, label: p.label, start: p.start, end: p.end, scan: p.mode === 'daily' ? { mode: 'daily' } : { mode: 'weekly', days: p.days ?? [] } })),
    comments,
    activity,
    observations,
    lastScan: last ? { ...last, running: (running?.n ?? 0) > 0 } : running?.n ? { at: '', status: 'running', running: true } : null,
  }
}

/**
 * Historique complet d'une zone pour l'export Excel : une ligne par fiche (retailer × produit), un prix par scan
 * depuis le tout premier. Ne dépend ni de la saison ni de la semaine : c'est l'évolution du prix à chaque passage.
 * Le RRP et la remise autorisée sont ceux d'aujourd'hui.
 */
export async function buildHistoryExport(q: Sql, zone: string) {
  const obs = await q.query<{ listing_id: string; scan_id: string; at: string; retailer: string; segmentation: string; reps: string[]; title: string; url: string; proof: string; pid: string | null; price: number; currency: string }>(
    `select l.id as listing_id, o.scan_id, ${ts('s.created_at')} as at, a.name as retailer, a.segmentation, a.sales_reps as reps, l.title, l.url, l.proof::text as proof,
            coalesce(l.product_id, l.candidate_product_id) as pid, o.price::float8 as price, o.currency::text as currency
     from observations o
     join scans s on s.id = o.scan_id
     join listings l on l.id = o.listing_id
     join accounts a on a.id = l.account_id
     where o.zone_id = $1 and a.status = 'active' and l.status = 'active'
     order by lower(a.name), l.title, s.created_at`,
    [zone],
  )
  const products = await q.query<{ id: string; sku: string; model: string; color: string; season: string; rule: number | null }>(
    "select id, sku, model, color, season, max_discount_pct::float8 as rule from products where zone_id = $1 and status = 'active'",
    [zone],
  )
  const rrps = await q.query<{ product_id: string; currency: string; amount: number }>(
    "select product_id, currency::text as currency, amount::float8 as amount from product_prices where zone_id = $1 and kind = 'rrp'",
    [zone],
  )
  const byProduct = new Map(products.map((p) => [p.id, p]))
  const rrp = new Map(rrps.map((r) => [`${r.product_id}|${r.currency}`, r.amount]))
  // Les colonnes : chaque scan qui a relevé au moins un prix, du plus ancien au plus récent.
  const scanAt = new Map<string, string>()
  for (const o of obs) scanAt.set(o.scan_id, o.at)
  const scans = [...scanAt.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const byListing = new Map<string, typeof obs>()
  for (const o of obs) byListing.set(o.listing_id, [...(byListing.get(o.listing_id) ?? []), o])
  const rows = [...byListing.values()].map((list) => {
    const first = list[0]
    const last = list[list.length - 1]
    const p = first.pid ? byProduct.get(first.pid) : undefined
    const byScan = new Map(list.map((o) => [o.scan_id, o.price]))
    return {
      retailer: first.retailer,
      segmentation: first.segmentation,
      salesReps: (first.reps ?? []).join(', '),
      title: first.title,
      url: first.url,
      sku: p?.sku ?? '',
      model: p?.model ?? '',
      color: p?.color ?? '',
      season: p?.season ?? '',
      proof: first.proof,
      currency: last.currency,
      rrp: p ? (rrp.get(`${p.id}|${last.currency}`) ?? null) : null,
      allowedPct: p?.rule ?? null,
      prices: scans.map(([id]) => byScan.get(id) ?? null),
    }
  })
  return { zone, scans: scans.map(([, at]) => at), rows }
}
