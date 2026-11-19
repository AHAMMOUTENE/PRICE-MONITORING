/**
 * API HTTP du suivi des prix (Hono : même code sous Node et sous Cloudflare Workers).
 * Identité : fournie par le SSO (en-tête Cloudflare Access), jamais par l'application.
 * Autorisation : par zone (user_zone_access), vérifiée ici avant tout accès aux données.
 */
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Db, Sql } from './db.ts'
import { createScan, loadEvalContext, runScan, writeEvaluation, type ScanDeps } from './scrape/scan.ts'
import { canonicalUrl } from './scrape/match.ts'
import { buildState, fetchRetailers } from './state.ts'
import { readSession, SESSION_COOKIE, signSession } from './session.ts'
import { HttpError, SKU_RE } from './util.ts'

export interface AppDeps extends ScanDeps {
  /** Lance une tâche en arrière-plan (Node : promesse libre ; Workers : ctx.waitUntil). */
  background?: (p: Promise<unknown>) => void
  /** Workers : un scan est trop long pour une requête ; il est seulement mis en attente, le déclencheur planifié le lance. */
  deferScans?: boolean
}
interface User {
  email: string
  name: string
  isAdmin: boolean
}
type Env = { Variables: { user: User } }

const URL_OK = /^https?:\/\/[^\s/]+\.[^\s]+$/i
const CUR_OK = /^[A-Z]{3}$/
const ZONE_OK = /^[A-Z]{2,8}$/
const EAN_OK = /^[0-9]{8,14}$/
const ROLE_RANK = { reader: 1, editor: 2, admin: 3 } as const

const prettyName = (email: string) =>
  email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

export function createApp(deps: AppDeps) {
  const { db } = deps
  const env = deps.env ?? {}
  const log = deps.log ?? (() => {})
  const background = deps.background ?? ((p) => void p.catch((e) => log('background-error', { error: String(e) })))
  const app = new Hono<Env>()
  const seen = new Map<string, number>()
  const admins = new Set((env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))

  app.get('/health', async (c) => {
    await db.query('select 1')
    return c.json({ ok: true })
  })

  // ── SSO simulé (développement seulement) : connexion par e-mail, session dans un cookie signé ──
  const simulated = env.SSO_SIMULATED === 'true' && env.NODE_ENV !== 'production'
  const secret = env.SESSION_SECRET || 'dev-only-secret'
  app.post('/api/auth/login', async (c) => {
    if (!simulated) throw new HttpError(404, 'not-found')
    const b = await json<{ email?: string }>(c)
    const email = String(b.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, 'email-invalid')
    setCookie(c, SESSION_COOKIE, await signSession(email, secret), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 12 })
    return c.json({ email })
  })
  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.body(null, 204)
  })

  // ── Identité ──
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next()
    const sso = c.req.header('cf-access-authenticated-user-email') || (simulated ? await readSession(getCookie(c, SESSION_COOKIE), secret) : env.NODE_ENV === 'production' ? '' : env.DEV_USER_EMAIL)
    const email = (sso || '').trim().toLowerCase()
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(401, 'unauthenticated')
    const user: User = { email, name: prettyName(email), isAdmin: admins.has(email) }
    const last = seen.get(email) ?? 0
    if (Date.now() - last > 60_000) {
      seen.set(email, Date.now())
      await db.query(
        `insert into users (email, display_name, is_admin, last_seen_at) values ($1, $2, $3, now())
         on conflict (email) do update set last_seen_at = now(), is_admin = users.is_admin or excluded.is_admin`,
        [email, user.name, user.isAdmin],
      )
    }
    c.set('user', user)
    await next()
  })

  /** Vérifie que l'utilisateur a le droit demandé sur la zone ; renvoie l'identifiant de zone. */
  async function zoneOf(c: Context<Env>, need: 'reader' | 'editor' = 'reader'): Promise<string> {
    const zone = c.req.param('zone') ?? ''
    if (!ZONE_OK.test(zone)) throw new HttpError(404, 'zone-unknown')
    const user = c.get('user')
    const [row] = await db.query<{ role: keyof typeof ROLE_RANK }>('select role::text as role from user_zone_access where user_email = $1 and zone_id = $2', [user.email, zone])
    const fallback = env.DEFAULT_ZONE_ROLE ?? 'editor'
    const role = user.isAdmin ? 'admin' : (row?.role ?? (fallback in ROLE_RANK ? (fallback as keyof typeof ROLE_RANK) : undefined))
    if (!role || ROLE_RANK[role] < ROLE_RANK[need]) throw new HttpError(403, 'forbidden')
    return zone
  }
  const json = async <T,>(c: Context<Env>): Promise<T> => {
    try {
      return (await c.req.json()) as T
    } catch {
      throw new HttpError(400, 'invalid-json')
    }
  }

  // Préférences de l'utilisateur (langue choisie, tutoriel vu) : la base fait foi, pas le navigateur.
  app.get('/api/me', async (c) => {
    const u = c.get('user')
    const [p] = await db.query<{ locale: string | null; tourDone: boolean }>('select locale, tour_done_at is not null as "tourDone" from user_preferences where user_email = $1', [u.email])
    return c.json({ id: u.email, name: u.name, locale: p?.locale ?? null, tourDone: p?.tourDone ?? false })
  })
  app.put('/api/me/preferences', async (c) => {
    const u = c.get('user')
    const b = await json<{ locale?: string; tourDone?: boolean }>(c)
    if (b.locale !== undefined && !['fr', 'en', 'pt', 'es'].includes(b.locale)) throw new HttpError(422, 'locale-invalid')
    await db.query(
      `insert into user_preferences (user_email, locale, tour_done_at) values ($1, $2, case when $3::boolean then now() end)
       on conflict (user_email) do update set locale = coalesce($2, user_preferences.locale),
         tour_done_at = coalesce(user_preferences.tour_done_at, case when $3::boolean then now() end)`,
      [u.email, b.locale ?? null, Boolean(b.tourDone)],
    )
    return c.body(null, 204)
  })

  app.get('/api/zones/:zone/state', async (c) => {
    const zone = await zoneOf(c)
    const state = await buildState(db, zone, { now: deps.now?.(), userEmail: c.get('user').email })
    if (!state) throw new HttpError(404, 'zone-unknown')
    return c.json(state)
  })

  // ── Comptes ──
  type RetailerBody = { id?: string; name: string; tracked?: boolean; segmentation?: string; salesReps?: string[]; sites?: { currency: string; url: string }[] }
  app.put('/api/zones/:zone/retailers', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const b = await json<RetailerBody>(c)
    const name = String(b.name ?? '').trim()
    if (!name || name.length > 200) throw new HttpError(422, 'name-invalid')
    const sites = (b.sites ?? []).filter((s) => s.url?.trim())
    for (const s of sites) if (!URL_OK.test(s.url.trim()) || !CUR_OK.test(s.currency)) throw new HttpError(422, 'site-invalid')
    const user = c.get('user')
    const id = await db.tx(async (q) => {
      const exists = b.id ? (await q.query('select 1 from accounts where id = $1::uuid and zone_id = $2 and status = \'active\'', [b.id, zone])).length > 0 : false
      let accountId = b.id ?? ''
      if (exists) {
        await q.query('update accounts set name = $3, segmentation = $4, sales_reps = array(select jsonb_array_elements_text($5::text::jsonb)), tracked = $6, updated_by = $7 where id = $1::uuid and zone_id = $2', [
          accountId, zone, name, b.segmentation ?? '', JSON.stringify(b.salesReps ?? []), b.tracked ?? true, user.email,
        ])
      } else {
        const [r] = await q.query<{ id: string }>(
          `insert into accounts (zone_id, name, segmentation, sales_reps, tracked, created_by, updated_by)
           values ($1, $2, $3, array(select jsonb_array_elements_text($4::text::jsonb)), $5, $6, $6) returning id`,
          [zone, name, b.segmentation ?? '', JSON.stringify(b.salesReps ?? []), b.tracked ?? true, user.email],
        )
        accountId = r.id
      }
      await syncSites(q, zone, accountId, sites.map((s) => ({ currency: s.currency, url: s.url.trim() })))
      return accountId
    })
    const [saved] = await fetchRetailers(db, zone, id)
    return c.json({ ...saved, excluded: undefined })
  })

  app.delete('/api/zones/:zone/retailers/:id', async (c) => {
    const zone = await zoneOf(c, 'editor')
    await db.query("update accounts set status = 'archived', archived_at = now(), updated_by = $3 where id = $1::uuid and zone_id = $2 and status = 'active'", [c.req.param('id'), zone, c.get('user').email])
    return c.body(null, 204)
  })

  app.post('/api/zones/:zone/retailers/tracked', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const b = await json<{ ids: string[]; tracked: boolean }>(c)
    await db.query('update accounts set tracked = $3, updated_by = $4 where zone_id = $1 and id in (select jsonb_array_elements_text($2::text::jsonb)::uuid)', [zone, JSON.stringify(b.ids ?? []), Boolean(b.tracked), c.get('user').email])
    return c.body(null, 204)
  })

  app.put('/api/zones/:zone/rules', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const b = await json<{ excludedRetailerIds: string[] }>(c)
    await db.query(
      "update accounts set excluded = (id in (select jsonb_array_elements_text($2::text::jsonb)::uuid)) where zone_id = $1 and status = 'active'",
      [zone, JSON.stringify(b.excludedRetailerIds ?? [])],
    )
    return c.body(null, 204)
  })

  // ── Commentaires ──
  app.post('/api/zones/:zone/comments', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const b = await json<{ retailerId: string; text: string }>(c)
    const text = String(b.text ?? '').trim()
    if (!text || text.length > 4000) throw new HttpError(422, 'text-invalid')
    const u = c.get('user')
    const [row] = await db.query(
      `insert into account_comments (account_id, zone_id, body, author_email, author_name)
       select a.id, a.zone_id, $3, $4, $5 from accounts a where a.id = $1::uuid and a.zone_id = $2 and a.status = 'active'
       returning id, account_id as "retailerId", body as text, author_name as by, to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, true as mine`,
      [b.retailerId, zone, text, u.email, u.name],
    )
    if (!row) throw new HttpError(404, 'account-unknown')
    return c.json(row, 201)
  })

  app.delete('/api/zones/:zone/comments/:id', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const [row] = await db.query<{ author_email: string }>('select author_email::text as author_email from account_comments where id = $1::uuid and zone_id = $2', [c.req.param('id'), zone])
    if (!row) throw new HttpError(404, 'comment-unknown')
    if (row.author_email !== c.get('user').email) throw new HttpError(403, 'not-author')
    await db.query('delete from account_comments where id = $1::uuid', [c.req.param('id')])
    return c.body(null, 204)
  })

  // ── Catalogue ──
  const TEXT_COLS = { model: 'model', material: 'material', color: 'color', dept: 'dept', season: 'season', segmentation: 'segmentation', colorCode: 'color_code', description: 'description', composition: 'composition', origin: 'origin' } as const
  app.put('/api/zones/:zone/products/:sku', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const sku = c.req.param('sku').toUpperCase()
    const p = await json<Record<string, any>>(c)
    const user = c.get('user')
    await db.tx(async (q) => {
      const [prod] = await q.query<{ id: string }>("select id from products where zone_id = $1 and sku = $2 and status = 'active'", [zone, sku])
      if (!prod) throw new HttpError(404, 'product-unknown')
      const sets: string[] = []
      const params: unknown[] = [prod.id]
      const add = (col: string, v: unknown) => {
        params.push(v)
        sets.push(`${col} = $${params.length}`)
      }
      for (const [key, col] of Object.entries(TEXT_COLS)) {
        if (!(key in p)) continue
        const v = p[key]
        if (['model', 'material', 'color', 'dept', 'season'].includes(key)) {
          if (key === 'season' && v && !/^[A-Z0-9/]{2,8}$/.test(String(v))) throw new HttpError(422, 'season-invalid')
          add(col, String(v ?? ''))
        } else add(col, v ? String(v) : null)
      }
      if ('ean' in p) {
        if (p.ean && !EAN_OK.test(String(p.ean))) throw new HttpError(422, 'ean-invalid')
        add('ean', p.ean ? String(p.ean) : null)
      }
      if ('carryOver' in p) add('carry_over', Boolean(p.carryOver))
      if ('maxDiscountPct' in p) {
        const v = p.maxDiscountPct
        if (v !== null && v !== undefined && !(Number(v) >= 0 && Number(v) <= 100)) throw new HttpError(422, 'discount-invalid')
        add('max_discount_pct', v === null || v === undefined ? null : Number(v))
      }
      add('updated_by', user.email)
      await q.query(`update products set ${sets.join(', ')} where id = $1`, params)
      for (const kind of ['rrp', 'wholesale'] as const) {
        for (const [cur, v] of Object.entries((p[kind] ?? {}) as Record<string, number | null>)) {
          if (!CUR_OK.test(cur)) continue
          if (v === null || v === undefined) await q.query('delete from product_prices where product_id = $1 and currency = $2 and kind = $3::price_kind', [prod.id, cur, kind])
          else if (Number(v) > 0)
            await q.query(
              `insert into product_prices (product_id, zone_id, currency, kind, amount, source, updated_by) values ($1, $2, $3, $4::price_kind, $5, 'manual', $6)
               on conflict (product_id, currency, kind) do update set amount = excluded.amount, source = 'manual', updated_by = excluded.updated_by, updated_at = now()`,
              [prod.id, zone, cur, kind, Number(v), user.email],
            )
        }
      }
    })
    return c.body(null, 204)
  })

  // ── Imports (le fichier est lu dans le navigateur ; l'API reçoit les lignes validées) ──
  app.post('/api/zones/:zone/imports/:kind', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const kind = c.req.param('kind')
    if (kind !== 'accounts' && kind !== 'catalog') throw new HttpError(404, 'import-unknown')
    const b = await json<{ fileName?: string; sheet?: string; delimiter?: string; season?: string; noDiscount?: boolean; fileColumns?: string[]; mapping?: unknown; skipped?: number; rows: any[] }>(c)
    if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 20_000) throw new HttpError(422, 'rows-invalid')
    const user = c.get('user')
    const count = await db.tx(async (q) => {
      const n = kind === 'accounts' ? await importAccounts(q, zone, b.rows, user.email) : await importCatalog(q, zone, b.rows, user.email)
      await q.query(
        `insert into imports (zone_id, kind, status, file_name, sheet, delimiter, season, no_discount, file_columns, mapping, rows_read, rows_skipped, rows_committed, created_by, committed_at)
         values ($1, $2::import_kind, 'committed', $3, $4, $5, $6, $7, array(select jsonb_array_elements_text($8::text::jsonb)), $9::text::jsonb, $10, $11, $12, $13, now())`,
        [zone, kind, String(b.fileName ?? 'import').slice(0, 300), b.sheet ?? null, [';', ',', '\t'].includes(b.delimiter ?? '') ? b.delimiter : null, b.season ?? null, b.noDiscount ?? null, JSON.stringify(b.fileColumns ?? []), JSON.stringify(b.mapping ?? {}), b.rows.length + (b.skipped ?? 0), b.skipped ?? 0, n, user.email],
      )
      return n
    })
    return c.json({ imported: count })
  })

  // ── Calendrier des soldes ──
  type PeriodBody = { label: string; start: string; end: string; scan: { mode: 'weekly'; days: number[] } | { mode: 'daily' } }
  const periodParams = (b: PeriodBody) => {
    if (!b.label?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(b.start) || !/^\d{4}-\d{2}-\d{2}$/.test(b.end) || b.end < b.start) throw new HttpError(422, 'period-invalid')
    const daily = b.scan?.mode === 'daily'
    const days = daily ? null : [...new Set((b.scan as { days: number[] }).days ?? [])].filter((d) => d >= 1 && d <= 7)
    if (!daily && !days?.length) throw new HttpError(422, 'period-invalid')
    return [b.label.trim(), b.start, b.end, daily ? 'daily' : 'weekly', days ? JSON.stringify(days) : null]
  }
  app.post('/api/zones/:zone/periods', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const params = periodParams(await json<PeriodBody>(c))
    await db.query(
      "insert into sale_periods (zone_id, label, start_on, end_on, scan_mode, scan_days, created_by) values ($1, $2, $3::date, $4::date, $5::scan_mode, case when $6::text::jsonb is null then null else array(select jsonb_array_elements_text($6::text::jsonb)::smallint) end, $7)",
      [zone, ...params, c.get('user').email],
    )
    return c.body(null, 201)
  })
  app.put('/api/zones/:zone/periods/:id', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const params = periodParams(await json<PeriodBody>(c))
    await db.query(
      "update sale_periods set label = $3, start_on = $4::date, end_on = $5::date, scan_mode = $6::scan_mode, scan_days = case when $7::text::jsonb is null then null else array(select jsonb_array_elements_text($7::text::jsonb)::smallint) end where id = $1::uuid and zone_id = $2",
      [c.req.param('id'), zone, ...params],
    )
    return c.body(null, 204)
  })
  app.delete('/api/zones/:zone/periods/:id', async (c) => {
    const zone = await zoneOf(c, 'editor')
    await db.query('delete from sale_periods where id = $1::uuid and zone_id = $2', [c.req.param('id'), zone])
    return c.body(null, 204)
  })

  // ── Scans ──
  app.post('/api/zones/:zone/scans', async (c) => {
    const zone = await zoneOf(c, 'editor')
    if (!deps.fetcher) throw new HttpError(422, 'scraping-not-configured')
    const scan = await createScan(deps, zone, { trigger: 'manual', requestedBy: c.get('user').email })
    if (!scan) throw new HttpError(409, 'scan-running')
    if (scan.sites === 0) {
      await db.query("update scans set status = 'done', started_at = now(), finished_at = now() where id = $1", [scan.id])
    } else if (!deps.deferScans) background(runScan(deps, scan.id))
    return c.json({ id: scan.id, total: scan.sites }, 202)
  })
  app.get('/api/zones/:zone/scans/:id', async (c) => {
    const zone = await zoneOf(c)
    const [s] = await db.query(
      'select status::text as status, sites_done + sites_failed as done, sites_total as total, sites_failed as failed, credits_used as credits, error from scans where id = $1::uuid and zone_id = $2',
      [c.req.param('id'), zone],
    )
    if (!s) throw new HttpError(404, 'scan-unknown')
    return c.json(s)
  })

  // ── Identification des produits ──
  app.post('/api/zones/:zone/listings/:id/decision', async (c) => {
    const zone = await zoneOf(c, 'editor')
    const d = await json<{ kind: 'accepted' | 'corrected' | 'no-match'; sku?: string }>(c)
    await db.tx((q) => decide(q, c.get('user').email, zone, c.req.param('id'), d))
    return c.body(null, 204)
  })
  app.delete('/api/zones/:zone/listings/:id/decision', async (c) => {
    const zone = await zoneOf(c, 'editor')
    await db.tx((q) => undo(q, c.get('user').email, zone, c.req.param('id')))
    return c.body(null, 204)
  })

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status)
    const code = (e as { code?: string }).code
    if (code === '23505') return c.json({ error: 'duplicate' }, 409)
    if (code === '23P01') return c.json({ error: 'overlap' }, 409)
    if (code === '23503') return c.json({ error: 'in-use' }, 409)
    if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') return c.json({ error: 'invalid-value' }, 422)
    log('request-error', { path: c.req.path, code, error: String(e) })
    return c.json({ error: 'internal' }, 500)
  })
  app.notFound((c) => c.json({ error: 'not-found' }, 404))
  return app
}

// ───────────────────────── Écritures ─────────────────────────

/** Aligne les pages d'un compte sur la liste reçue : ajoute, met à jour, retire (ou désactive si des fiches en dépendent). */
async function syncSites(q: Sql, zone: string, accountId: string, sites: { currency: string; url: string }[]) {
  const keep: string[] = []
  for (const [i, s] of sites.entries()) {
    const [r] = await q.query<{ id: string }>(
      `insert into account_sites (account_id, zone_id, currency, url, position, enabled) values ($1::uuid, $2, $3, $4, $5, true)
       on conflict (account_id, url) do update set currency = excluded.currency, position = excluded.position, enabled = true returning id`,
      [accountId, zone, s.currency, s.url, i],
    )
    keep.push(r.id)
  }
  await q.query(
    `update account_sites set enabled = false where account_id = $1::uuid and id not in (select jsonb_array_elements_text($2::text::jsonb)::uuid) and exists (select 1 from listings l where l.site_id = account_sites.id)`,
    [accountId, JSON.stringify(keep)],
  )
  await q.query(
    `delete from account_sites where account_id = $1::uuid and id not in (select jsonb_array_elements_text($2::text::jsonb)::uuid) and not exists (select 1 from listings l where l.site_id = account_sites.id)`,
    [accountId, JSON.stringify(keep)],
  )
}

interface ImportedAccount {
  name: string
  website: string
  currency: string
  segmentation: string
  reps: string[]
}
async function importAccounts(q: Sql, zone: string, rows: ImportedAccount[], email: string): Promise<number> {
  const [z] = await q.query<{ default_currency: string }>('select default_currency::text as default_currency from zones where id = $1', [zone])
  let n = 0
  for (const row of rows) {
    const name = String(row.name ?? '').trim()
    if (!name) continue
    const website = String(row.website ?? '').trim()
    const currency = CUR_OK.test(row.currency) ? row.currency : z.default_currency
    const reps = JSON.stringify(Array.isArray(row.reps) ? row.reps.map(String) : [])
    const [existing] = await q.query<{ id: string }>("select id from accounts where zone_id = $1 and lower(btrim(name)) = lower($2) and status = 'active'", [zone, name])
    let id = existing?.id
    if (id) {
      // Réimporter met à jour sans effacer : segmentation et commerciaux seulement s'ils sont renseignés.
      await q.query(
        `update accounts set segmentation = coalesce(nullif($2, ''), segmentation),
           sales_reps = case when jsonb_array_length($3::text::jsonb) > 0 then array(select jsonb_array_elements_text($3::text::jsonb)) else sales_reps end, updated_by = $4 where id = $1::uuid`,
        [id, row.segmentation ?? '', reps, email],
      )
    } else {
      const [r] = await q.query<{ id: string }>(
        "insert into accounts (zone_id, name, segmentation, sales_reps, created_by, updated_by) values ($1, $2, $3, array(select jsonb_array_elements_text($4::text::jsonb)), $5, $5) returning id",
        [zone, name, row.segmentation ?? '', reps, email],
      )
      id = r.id
    }
    if (URL_OK.test(website)) {
      const [has] = await q.query('select 1 from account_sites where account_id = $1::uuid limit 1', [id])
      if (!has) await q.query('insert into account_sites (account_id, zone_id, currency, url, position) values ($1::uuid, $2, $3, $4, 0) on conflict do nothing', [id, zone, currency, website])
    }
    n++
  }
  return n
}

interface ImportedProduct {
  sku: string
  model?: string
  material?: string
  color?: string
  season?: string
  carryOver?: boolean
  dept?: string
  variants?: string[]
  rrp?: Record<string, number>
  wholesale?: Record<string, number>
  maxDiscountPct?: number
  extra?: Record<string, string | undefined>
}
async function importCatalog(q: Sql, zone: string, rows: ImportedProduct[], email: string): Promise<number> {
  // Un même SKU peut apparaître plusieurs fois (une ligne par taille) : on fusionne avant d'écrire.
  const merged = new Map<string, any>()
  for (const r of rows) {
    const sku = String(r.sku ?? '').toUpperCase()
    if (!SKU_RE.test(sku)) continue
    const cur = merged.get(sku) ?? { sku, variants: [] as string[], rrp: {}, wholesale: {}, ean: null }
    for (const k of ['model', 'material', 'color', 'dept'] as const) if (r[k]) cur[k] = r[k]
    if (r.season && /^[A-Z0-9/]{2,8}$/.test(r.season)) cur.season = r.season
    if (r.carryOver !== undefined) cur.carryOver = r.carryOver
    if (r.maxDiscountPct !== undefined && r.maxDiscountPct !== null) cur.maxDiscountPct = r.maxDiscountPct
    cur.variants = [...new Set([...cur.variants, ...(r.variants ?? [])].filter((v) => /^[A-Z]$/.test(v)))]
    Object.assign(cur.rrp, r.rrp ?? {})
    Object.assign(cur.wholesale, r.wholesale ?? {})
    for (const k of ['segmentation', 'colorCode', 'description', 'composition', 'origin'] as const) if (r.extra?.[k]) cur[k] = r.extra[k]
    if (r.extra?.ean && EAN_OK.test(r.extra.ean)) cur.ean = r.extra.ean
    merged.set(sku, cur)
  }
  const list = [...merged.values()]
  const prices: { sku: string; currency: string; kind: string; amount: number }[] = []
  for (const p of list) {
    for (const [kind, map] of [['rrp', p.rrp], ['wholesale', p.wholesale]] as const)
      for (const [currency, amount] of Object.entries(map as Record<string, number>)) if (CUR_OK.test(currency) && amount > 0) prices.push({ sku: p.sku, currency, kind, amount })
  }
  for (let i = 0; i < list.length; i += 400) {
    await q.query(
      `insert into products (zone_id, sku, variants, model, material, color, dept, season, carry_over, max_discount_pct, segmentation, color_code, description, composition, origin, ean, updated_by)
       select $1, x.sku, array(select jsonb_array_elements_text(coalesce(x.variants, '[]'::jsonb))), coalesce(x.model, ''), coalesce(x.material, ''), coalesce(x.color, ''), coalesce(x.dept, ''), coalesce(x.season, ''),
              coalesce(x."carryOver", false), x."maxDiscountPct", x.segmentation, x."colorCode", x.description, x.composition, x.origin, x.ean, $3
       from jsonb_to_recordset($2::text::jsonb) as x(sku text, variants jsonb, model text, material text, color text, dept text, season text, "carryOver" boolean, "maxDiscountPct" numeric,
                                                segmentation text, "colorCode" text, description text, composition text, origin text, ean text)
       on conflict (zone_id, sku) do update set
         variants = (select coalesce(array_agg(distinct v order by v), '{}') from unnest(products.variants || excluded.variants) v),
         model = coalesce(nullif(excluded.model, ''), products.model), material = coalesce(nullif(excluded.material, ''), products.material),
         color = coalesce(nullif(excluded.color, ''), products.color), dept = coalesce(nullif(excluded.dept, ''), products.dept),
         season = coalesce(nullif(excluded.season, ''), products.season),
         carry_over = case when jsonb_exists($4::text::jsonb, products.sku) then excluded.carry_over else products.carry_over end,
         max_discount_pct = coalesce(excluded.max_discount_pct, products.max_discount_pct),
         segmentation = coalesce(excluded.segmentation, products.segmentation), color_code = coalesce(excluded.color_code, products.color_code),
         description = coalesce(excluded.description, products.description), composition = coalesce(excluded.composition, products.composition),
         origin = coalesce(excluded.origin, products.origin), ean = coalesce(excluded.ean, products.ean),
         status = 'active', archived_at = null, updated_by = excluded.updated_by`,
      [zone, JSON.stringify(list.slice(i, i + 400)), email, JSON.stringify(Object.fromEntries(list.filter((p) => p.carryOver !== undefined).map((p) => [p.sku, true])))],
    )
  }
  for (let i = 0; i < prices.length; i += 2000) {
    await q.query(
      `insert into product_prices (product_id, zone_id, currency, kind, amount, source, updated_by)
       select p.id, p.zone_id, x.currency, x.kind::price_kind, x.amount, 'import', $3
       from jsonb_to_recordset($2::text::jsonb) as x(sku text, currency text, kind text, amount numeric)
       join products p on p.zone_id = $1 and p.sku = x.sku
       on conflict (product_id, currency, kind) do update set amount = excluded.amount, source = 'import', updated_by = excluded.updated_by, updated_at = now()`,
      [zone, JSON.stringify(prices.slice(i, i + 2000)), email],
    )
  }
  return list.length
}

// ───────────────────────── Décisions ─────────────────────────

interface ListingRow {
  id: string
  site_id: string
  url: string
  ean: string | null
  product_id: string | null
  candidate_product_id: string | null
  status: string
}

async function decide(q: Sql, email: string, zone: string, listingId: string, d: { kind: 'accepted' | 'corrected' | 'no-match'; sku?: string }) {
  const [l] = await q.query<ListingRow>('select id, site_id, url, ean, product_id, candidate_product_id, status::text as status from listings where id = $1::uuid and zone_id = $2 for update', [listingId, zone])
  if (!l) throw new HttpError(404, 'listing-unknown')
  let productId: string | null = null
  if (d.kind === 'accepted') {
    if (!l.candidate_product_id) throw new HttpError(422, 'no-candidate')
    productId = l.candidate_product_id
  } else if (d.kind === 'corrected') {
    const [p] = await q.query<{ id: string }>("select id from products where zone_id = $1 and sku = $2 and status = 'active'", [zone, String(d.sku ?? '').toUpperCase()])
    if (!p) throw new HttpError(422, 'sku-unknown')
    productId = p.id
  } else if (d.kind !== 'no-match') throw new HttpError(422, 'decision-invalid')

  const [prev] = await q.query<{ id: string }>('select id from review_decisions where listing_id = $1 and undone_at is null', [listingId])
  if (prev) {
    await q.query('update review_decisions set undone_at = now(), undone_by = $2 where id = $1', [prev.id, email])
    await q.query('delete from product_aliases where decision_id = $1', [prev.id])
  }
  const [obs] = await q.query<{ id: string; price: number; currency: string; excluded: boolean }>(
    `select o.id, o.price::float8 as price, o.currency::text as currency, a.excluded from observations o join accounts a on a.id = o.account_id where o.listing_id = $1 order by o.observed_at desc limit 1`,
    [listingId],
  )
  const [dec] = await q.query<{ id: string }>(
    `insert into review_decisions (zone_id, listing_id, observation_id, kind, product_id, previous_product_id, decided_by) values ($1, $2, $3, $4::review_kind, $5, $6, $7) returning id`,
    [zone, listingId, obs?.id ?? null, d.kind, productId, l.product_id, email],
  )
  await q.query(
    `update listings set product_id = $2, proof = $3::proof_kind, match_kind = 'alias', status = $4::listing_status where id = $1`,
    [listingId, productId, productId ? 'confirmed' : 'to-review', d.kind === 'no-match' ? 'dismissed' : 'active'],
  )
  // Ce que l'outil retient : cette page et cette adresse (et l'EAN, valable partout) désignent désormais ce produit.
  const alias = (kind: string, value: string, siteId: string | null) =>
    q.query(
      `insert into product_aliases (zone_id, site_id, kind, value, verdict, product_id, decision_id, created_by) values ($1, $2, $3::alias_kind, $4, $5::alias_verdict, $6, $7, $8)
       on conflict (zone_id, kind, value, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set verdict = excluded.verdict, product_id = excluded.product_id, decision_id = excluded.decision_id`,
      [zone, siteId, kind, value, productId ? 'product' : 'not-veja', productId, dec.id, email],
    )
  await alias('url', canonicalUrl(l.url), l.site_id)
  if (productId && l.ean) await alias('ean', l.ean, null)
  if (productId && obs) await writeEvaluation(q, await loadEvalContext(q, zone), { observationId: obs.id, zone, productId, proof: 'confirmed', price: obs.price, currency: obs.currency, excluded: obs.excluded, cause: 'decision', decisionId: dec.id })
}

async function undo(q: Sql, email: string, zone: string, listingId: string) {
  const [d] = await q.query<{ id: string; previous_product_id: string | null; kind: string }>(
    'select id, previous_product_id, kind::text as kind from review_decisions where listing_id = $1 and zone_id = $2 and undone_at is null',
    [listingId, zone],
  )
  if (!d) return
  await q.query('update review_decisions set undone_at = now(), undone_by = $2 where id = $1', [d.id, email])
  await q.query('delete from product_aliases where decision_id = $1', [d.id])
  await q.query(
    `update listings set product_id = $2, proof = $3::proof_kind, match_kind = 'none', status = 'active' where id = $1`,
    [listingId, d.previous_product_id, d.previous_product_id ? 'confirmed' : 'to-review'],
  )
  const [obs] = await q.query<{ id: string; price: number; currency: string; excluded: boolean; product_id: string | null; candidate: string | null }>(
    `select o.id, o.price::float8 as price, o.currency::text as currency, a.excluded, l.product_id, l.candidate_product_id as candidate
     from observations o join accounts a on a.id = o.account_id join listings l on l.id = o.listing_id where o.listing_id = $1 order by o.observed_at desc limit 1`,
    [listingId],
  )
  if (obs) await writeEvaluation(q, await loadEvalContext(q, zone), { observationId: obs.id, zone, productId: obs.product_id ?? obs.candidate, proof: obs.product_id ? 'confirmed' : 'to-review', price: obs.price, currency: obs.currency, excluded: obs.excluded, cause: 'decision', decisionId: d.id })
}

export type { Db }
