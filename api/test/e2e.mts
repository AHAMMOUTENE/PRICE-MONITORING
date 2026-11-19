import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'node:fs'
import { createApp } from '../src/app.ts'
import { pgliteDb } from '../src/db.ts'
import { tickScheduler } from '../src/scrape/scan.ts'
import type { Fetcher } from '../src/scrape/fetcher.ts'

let fails = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'OK ' : 'KO '} ${name}${extra ? ' — ' + extra : ''}`)
}

const pg = new PGlite({ extensions: { citext, btree_gist } })
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => !/^(revoke|alter default privileges)/.test(l))
  .join('\n')
await pg.exec(schema)
const db = pgliteDb(pg as never)

const ld = (items: object[]) =>
  `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: items.map((item) => ({ '@type': 'ListItem', item })) })}</script></html>`
const prod = (name: string, price: number, sku?: string, brand = 'VEJA') => ({
  '@type': 'Product',
  name,
  sku,
  brand: { name: brand },
  url: `https://shop.example/p/${encodeURIComponent(name)}`,
  offers: { '@type': 'Offer', price, priceCurrency: 'EUR' },
})
let hits = 0
const fetcher: Fetcher = {
  async fetch(url) {
    hits++
    if (url.includes('broken')) return { status: 500, body: '', credits: 0 }
    return {
      status: 200,
      credits: 1,
      body: ld([prod('VEJA Campo Chromefree White Natural', 96, 'CP0502429A'), prod('VEJA Esplar Logo Leather Black', 90), prod('Nike Air Max', 50, undefined, 'Nike')]),
    }
  },
}
const env = { DEV_USER_EMAIL: 'jane.doe@example.com', ADMIN_EMAILS: '', DEFAULT_ZONE_ROLE: 'editor', SCAN_COOLDOWN_MINUTES: '0', SITE_COOLDOWN_HOURS: '0', MAX_SCANS_PER_ZONE_PER_DAY: '50' }
const clock = { now: new Date('2026-11-23T08:00:00Z') } // lundi
const app = createApp({ db, fetcher, env, now: () => clock.now })
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}
const waitScan = async (id: string) => {
  let st: any
  for (let i = 0; i < 200; i++) {
    st = (await call('GET', `/api/zones/EMEA/scans/${id}`)).json
    if (!['queued', 'running'].includes(st.status)) break
    await new Promise((r) => setTimeout(r, 50))
  }
  return st
}

// Catalogue : un produit à 20 % max, un non soldé (0), RRP en EUR.
const cat = await call('POST', '/api/zones/EMEA/imports/catalog', {
  fileName: 'masterfile.xlsx',
  rows: [
    { sku: 'CP0502429', variants: ['A', 'B'], model: 'Campo', material: 'Chromefree', color: 'White Natural', season: 'AW26', rrp: { EUR: 140 }, wholesale: { EUR: 70 }, maxDiscountPct: 20 },
    { sku: 'EA0302141', model: 'Esplar', material: 'Leather', color: 'Black', season: 'AW26', carryOver: true, rrp: { EUR: 120 }, maxDiscountPct: 0 },
    { sku: 'EA0302141', model: 'Esplar', rrp: { USD: 130 } },
    { sku: 'BAD', model: 'x' },
  ],
})
ok('import catalogue (SKU invalide écarté, doublon fusionné)', cat.status === 200 && cat.json.imported === 2, JSON.stringify(cat.json))
const acc = await call('POST', '/api/zones/EMEA/imports/accounts', {
  fileName: 'follow-up.xlsx',
  rows: [
    { name: 'Shop A', website: 'https://shop.example/veja', currency: 'EUR', segmentation: 'T1', reps: ['Marcel'] },
    { name: 'Shop B', website: 'https://broken.example/veja', currency: 'EUR', segmentation: '', reps: [] },
  ],
})
ok('import comptes', acc.json.imported === 2, JSON.stringify(acc.json))
const re = await call('POST', '/api/zones/EMEA/imports/accounts', { fileName: 'again.xlsx', rows: [{ name: 'shop a', website: '', currency: '', segmentation: '', reps: [] }] })
ok('réimport sans doublon', re.json.imported === 1 && (await pg.query('select 1 from accounts')).rows.length === 2)

let state = (await call('GET', '/api/zones/EMEA/state')).json
ok('état : comptes, produits, prix par devise', state.retailers.length === 2 && state.catalog.length === 2 && state.catalog[1].rrp.USD === 130 && state.catalog[0].wholesale.EUR === 70, JSON.stringify(state.catalog))
ok('état : variantes et carry-over', state.catalog[0].variants.join() === 'A,B' && state.catalog[1].carryOver === true)
const shopA = state.retailers.find((r: any) => r.name === 'Shop A')

const scan = await call('POST', '/api/zones/EMEA/scans')
ok('scan lancé', scan.status === 202 && scan.json.total === 2, JSON.stringify(scan.json))
const st = await waitScan(scan.json.id)
ok('scan partiel (un site en échec, l autre non)', st.status === 'partial' && st.done === 2 && st.failed === 1, JSON.stringify(st))
state = (await call('GET', '/api/zones/EMEA/state')).json
ok('2 fiches VEJA, l autre marque écartée', state.observations.length === 2, String(state.observations.length))
const campo = state.observations.find((o: any) => o.sku === 'CP0502429')
ok('SKU lu dans la référence : confirmé', campo?.proof === 'confirmed' && campo.rrp === 140 && campo.history.at(-1).price === 96, JSON.stringify(campo))
const esplar = state.observations.find((o: any) => !o.sku)
ok('titre proche : à vérifier avec candidat', esplar?.proof === 'to-review' && esplar.candidate?.sku === 'EA0302141', JSON.stringify(esplar?.candidate))
const evals = await pg.query("select sku, evaluation::text e, reason::text r, discount_pct::float8 d from observation_evaluations where is_current order by sku")
ok('évaluation figée : Campo -31,4 % > 20 % = anomalie', evals.rows.some((r: any) => r.sku === 'CP0502429' && r.e === 'anomaly' && r.r === 'over-max-discount' && r.d === 31.4), JSON.stringify(evals.rows))
ok('Esplar (non soldé, 90/120) = anomalie non soldé', evals.rows.some((r: any) => r.sku === 'EA0302141' && r.r === 'non-discounted-model'))
const second = await call('POST', '/api/zones/EMEA/scans')
ok('second scan possible une fois le premier fini', second.status === 202)
await waitScan(second.json.id)
const obsCount = ((await pg.query<{ n: number }>('select count(*)::int n from observations')).rows[0]).n
ok('relevés ajoutés (historique en ajout seul)', obsCount === 4, String(obsCount))

const d1 = await call('POST', `/api/zones/EMEA/listings/${esplar.id}/decision`, { kind: 'accepted' })
state = (await call('GET', '/api/zones/EMEA/state')).json
ok('décision acceptée : confirmé + alias appris', d1.status === 204 && state.observations.find((o: any) => o.id === esplar.id).sku === 'EA0302141' && (await pg.query('select 1 from product_aliases')).rows.length >= 1, JSON.stringify(d1))
ok('activité enregistrée', state.activity.some((a: any) => a.kind === 'accepted'))
await call('DELETE', `/api/zones/EMEA/listings/${esplar.id}/decision`)
state = (await call('GET', '/api/zones/EMEA/state')).json
ok('annulation : de nouveau à vérifier, alias oublié', state.observations.find((o: any) => o.id === esplar.id).proof === 'to-review' && (await pg.query('select 1 from product_aliases')).rows.length === 0)
await call('POST', `/api/zones/EMEA/listings/${esplar.id}/decision`, { kind: 'no-match' })
state = (await call('GET', '/api/zones/EMEA/state')).json
ok('pas VEJA : fiche retirée', !state.observations.some((o: any) => o.id === esplar.id))

await call('PUT', '/api/zones/EMEA/rules', { excludedRetailerIds: [shopA.id] })
await call('POST', '/api/zones/EMEA/retailers/tracked', { ids: [shopA.id], tracked: false })
state = (await call('GET', '/api/zones/EMEA/state')).json
ok('exclusion et suivi enregistrés', state.excludedRetailerIds.includes(shopA.id) && state.retailers.find((r: any) => r.id === shopA.id).tracked === false)
await call('POST', '/api/zones/EMEA/retailers/tracked', { ids: [shopA.id], tracked: true })
const cm = await call('POST', '/api/zones/EMEA/comments', { retailerId: shopA.id, text: 'Appelé le 12' })
ok('commentaire (auteur = SSO)', cm.status === 201 && cm.json.mine === true && cm.json.by === 'Jane Doe', JSON.stringify(cm.json))
const del = await call('DELETE', `/api/zones/EMEA/comments/${cm.json.id}`, undefined, { 'cf-access-authenticated-user-email': 'autre@example.com' })
ok('seul l auteur supprime', del.status === 403)
const put = await call('PUT', '/api/zones/EMEA/products/CP0502429', { maxDiscountPct: null, rrp: { GBP: 125, EUR: null }, carryOver: true })
state = (await call('GET', '/api/zones/EMEA/state')).json
const c0 = state.catalog.find((c: any) => c.sku === 'CP0502429')
ok('produit : règle retirée, RRP fusionné', put.status === 204 && c0.maxDiscountPct === undefined && c0.rrp.GBP === 125 && c0.rrp.EUR === undefined && c0.carryOver === true, JSON.stringify(c0))
const p1 = await call('POST', '/api/zones/EMEA/periods', { label: 'Black Friday', start: '2026-11-23', end: '2026-11-30', scan: { mode: 'weekly', days: [1, 3, 5] } })
const p2 = await call('POST', '/api/zones/EMEA/periods', { label: 'Chevauche', start: '2026-11-28', end: '2026-12-05', scan: { mode: 'daily' } })
ok('période créée, chevauchement refusé (409)', p1.status === 201 && p2.status === 409, `${p1.status} ${p2.status}`)

// Planificateur : lundi 23/11 à 09:00 Paris (après 05:00), jour de scan : un scan, une seule fois.
const before = hits
const started = await tickScheduler({ db, fetcher, env, now: () => clock.now })
await new Promise((r) => setTimeout(r, 600))
const again = await tickScheduler({ db, fetcher, env, now: () => clock.now })
ok('planificateur : un scan planifié, pas de doublon', started.length === 1 && again.length === 0 && hits > before, `${started.length} ${again.length}`)
clock.now = new Date('2026-11-24T08:00:00Z') // mardi, période 1-3-5 : pas de scan
ok('mardi hors plan : aucun scan', (await tickScheduler({ db, fetcher, env, now: () => clock.now })).length === 0)

await pg.query("insert into users (email, display_name) values ('lecteur@example.com', 'Lecteur')")
await pg.query("insert into user_zone_access (user_email, zone_id, role) values ('lecteur@example.com', 'EMEA', 'reader')")
const ro = await call('POST', '/api/zones/EMEA/scans', undefined, { 'cf-access-authenticated-user-email': 'lecteur@example.com' })
ok('lecteur : écriture refusée (403)', ro.status === 403, String(ro.status))
const prodApp = createApp({ db, fetcher, env: { NODE_ENV: 'production' } })
ok('production sans SSO : 401', (await prodApp.request('/api/me')).status === 401)


// Garde-fous : plafond de crédits du jour, délai entre scans, interrupteur, coupe-circuit.
const guarded = (extra: Record<string, string>) => {
  const a = createApp({ db, fetcher, env: { ...env, ...extra }, now: () => clock.now })
  return async (m: string, path: string) => {
    const r = await a.request(path, { method: m })
    return { status: r.status, json: (await r.json().catch(() => null)) as any }
  }
}
const hitsBefore = hits
const capped = guarded({ MAX_CREDITS_PER_DAY: '1' })
const cs = await capped('POST', '/api/zones/EMEA/scans')
const cst = await waitScan(cs.json.id)
const skipped = (await pg.query("select count(*)::int n from scan_sites where scan_id = $1 and status = 'skipped' and error = 'budget-daily'", [cs.json.id])).rows[0] as { n: number }
ok('plafond de crédits du jour : sites ignorés, aucun appel payant', cst.status === 'partial' && skipped.n === 2 && hits === hitsBefore, JSON.stringify(cst))
const soon = await guarded({ SCAN_COOLDOWN_MINUTES: '30' })('POST', '/api/zones/EMEA/scans')
ok('délai minimum entre deux scans (429)', soon.status === 429 && soon.json.error === 'scan-too-soon', JSON.stringify(soon))
const off = await guarded({ SCANS_ENABLED: 'false' })('POST', '/api/zones/EMEA/scans')
ok('interrupteur général (503)', off.status === 503)
const day = await guarded({ MAX_SCANS_PER_ZONE_PER_DAY: '1' })('POST', '/api/zones/EMEA/scans')
ok('plafond de scans par jour (429)', day.status === 429 && day.json.error === 'scan-daily-limit')
const recentSkip = guarded({ SITE_COOLDOWN_HOURS: '6' })
const rs = await recentSkip('POST', '/api/zones/EMEA/scans')
const rst = await waitScan(rs.json.id)
const recentN = (await pg.query("select count(*)::int n from scan_sites where scan_id = $1 and error = 'recent'", [rs.json.id])).rows[0] as { n: number }
ok('site visité il y a moins de 6 h : pas de seconde visite', recentN.n >= 1 && rst.done === 2, JSON.stringify(rst))
const tripped = guarded({ MAX_CONSECUTIVE_FAILURES: '1', SCAN_CONCURRENCY: '1' })
await pg.query("update accounts set name = name where false")
await pg.query("update account_sites set url = 'https://broken.example/a' where url like '%shop.example%'")
const ts2 = await tripped('POST', '/api/zones/EMEA/scans')
const tst = await waitScan(ts2.json.id)
ok('coupe-circuit : après des échecs, le reste du scan est arrêté', tst.status === 'partial' && String(tst.error).includes('circuit-open'), JSON.stringify(tst))

// SSO simulé : pas de session = 401 ; connexion par e-mail = cookie signé ; cookie falsifié refusé ; interdit en production.
const sim = createApp({ db, fetcher, env: { SSO_SIMULATED: 'true', SESSION_SECRET: 's3cret' }, now: () => clock.now })
ok('SSO simulé : sans session, 401', (await sim.request('/api/me')).status === 401)
const login = await sim.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'Jane.Doe@example.com' }) })
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
const me = await sim.request('/api/me', { headers: { cookie } })
ok('SSO simulé : connexion puis identité', login.status === 200 && me.status === 200 && ((await me.json()) as { name: string }).name === 'Jane Doe')
ok('SSO simulé : cookie falsifié refusé', (await sim.request('/api/me', { headers: { cookie: cookie.replace(/.$/, (c) => (c === '0' ? '1' : '0')) } })).status === 401)
const prodSim = createApp({ db, fetcher, env: { SSO_SIMULATED: 'true', NODE_ENV: 'production' } })
ok('SSO simulé : refusé en production', (await prodSim.request('/api/auth/login', { method: 'POST', body: '{}' })).status === 404)

// Préférences par utilisateur : un nouvel utilisateur n'a ni langue ni tutoriel ; ils sont ensuite mémorisés pour lui seul.
const newbie = { 'cf-access-authenticated-user-email': 'new.user@example.com' }
const m0 = (await call('GET', '/api/me', undefined, newbie)).json
ok('nouvel utilisateur : pas de langue, tutoriel à faire', m0.locale === null && m0.tourDone === false, JSON.stringify(m0))
await call('PUT', '/api/me/preferences', { locale: 'pt' }, newbie)
await call('PUT', '/api/me/preferences', { tourDone: true }, newbie)
const m1 = (await call('GET', '/api/me', undefined, newbie)).json
ok('langue et tutoriel mémorisés (sans s écraser)', m1.locale === 'pt' && m1.tourDone === true, JSON.stringify(m1))
ok('autre utilisateur non affecté', (await call('GET', '/api/me', undefined, { 'cf-access-authenticated-user-email': 'other@example.com' })).json.locale === null)
ok('langue inconnue refusée', (await call('PUT', '/api/me/preferences', { locale: 'xx' }, newbie)).status === 422)

console.log(fails ? `\n${fails} échec(s)` : '\nTout est OK')
process.exit(fails ? 1 : 0)
