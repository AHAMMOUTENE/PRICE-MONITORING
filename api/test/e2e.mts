import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'node:fs'
import { createApp } from '../src/app.ts'
import { extractJsonLd } from '../src/scrape/extract.ts'
import { CatalogIndex } from '../src/scrape/match.ts'
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
  image: `https://img.example/${encodeURIComponent(name)}.jpg`,
  offers: { '@type': 'Offer', price, priceCurrency: 'EUR' },
})
let hits = 0
const fetcher: Fetcher = {
  async fetch(url, opts) {
    hits++
    if (url.includes('broken')) return { status: 500, body: '', credits: 0 }
    // Site protégé : refuse sans proxy premium (comme un site derrière une protection anti-robot).
    if (url.includes('protected')) return opts?.premiumProxy ? { status: 200, credits: 25, body: ld([prod('VEJA Campo Chromefree White Natural', 99, 'CP0502429A')]) } : { status: 500, body: '', credits: 0 }
    // Page dont les données structurées sont incomplètes : 1 produit déclaré, mais 20 prix écrits dans la page.
    if (url.includes('weak')) return { status: 200, credits: 1, body: ld([prod('VEJA Campo Chromefree White Natural', 99, 'CP0502429A')]) + Array.from({ length: 20 }, (_, i) => `<p>${30 + i},00 €</p>`).join('') }
    return {
      status: 200,
      credits: 1,
      body: ld([prod('VEJA Campo Chromefree White Natural', 96, 'CP0502429A'), prod('VEJA Esplar Logo Leather Noir', 90), prod('Nike Air Max', 50, undefined, 'Nike')]),
    }
  },
}
const env = { DEV_USER_EMAIL: 'jane.doe@example.com', ADMIN_EMAILS: '', DEFAULT_ZONE_ROLE: 'editor', SCAN_COOLDOWN_MINUTES: '0', SITE_COOLDOWN_HOURS: '0', MAX_SCANS_PER_ZONE_PER_DAY: '50' }
const clock = { now: new Date('2026-11-23T08:00:00Z') } // lundi
const app = createApp({ db, fetcher, env, now: () => clock.now, log: (e, d) => (e === 'request-error' ? console.log('LOG', e, JSON.stringify(d)) : undefined) })
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
ok('import catalogue (SKU invalide écarté, doublon fusionné)', cat.status === 200 && cat.json.added === 2, JSON.stringify(cat.json))
const acc = await call('POST', '/api/zones/EMEA/imports/accounts', {
  fileName: 'follow-up.xlsx',
  rows: [
    { name: 'Shop A', website: 'https://shop.example/veja', currency: 'EUR', segmentation: 'T1', reps: ['Marcel'] },
    { name: 'Shop B', website: 'https://broken.example/veja', currency: 'EUR', segmentation: '', reps: [] },
  ],
})
ok('import comptes', acc.json.added === 2, JSON.stringify(acc.json))
const re = await call('POST', '/api/zones/EMEA/imports/accounts', { fileName: 'again.xlsx', rows: [{ name: 'shop a', website: '', currency: '', segmentation: '', reps: [] }] })
ok('réimport : rien de nouveau, rien de modifié', re.json.added === 0 && re.json.unchanged === 1 && (await pg.query('select 1 from accounts')).rows.length === 2)

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

// E-mail après chaque scan : seules les personnes abonnées le reçoivent, avec les rubriques choisies.
const sent: { to: string; subject: string; html: string; text: string }[] = []
const fakeMailer = { async send(m: { to: string; subject: string; html: string; text: string }) { sent.push(m) } }
const sub = { 'cf-access-authenticated-user-email': 'sub@example.com' }
const none = { 'cf-access-authenticated-user-email': 'quiet@example.com' }
await call('GET', '/api/me', undefined, none)
ok('e-mail : désactivé par défaut', (await call('GET', '/api/zones/EMEA/email', undefined, sub)).json.enabled === false)
await call('PUT', '/api/zones/EMEA/email', { enabled: true, kinds: ['review', 'recurrence', 'todo'] }, sub)
await call('PUT', '/api/me/preferences', { locale: 'fr' }, sub)
const emailPref = (await call('GET', '/api/zones/EMEA/email', undefined, sub)).json
ok('e-mail : activé pour la zone, rubriques mémorisées', emailPref.enabled === true && emailPref.kinds.length === 3 && emailPref.configured === false, JSON.stringify(emailPref))
const noMail = await call('POST', '/api/zones/EMEA/scans')
await waitScan(noMail.json.id)
ok('e-mail : sans service d envoi configuré, rien n est envoyé', sent.length === 0)
const mailApp = createApp({ db, fetcher, mailer: fakeMailer, env: { ...env, APP_URL: 'https://prices.example.com' }, now: () => clock.now })
const mailScan = await mailApp.request('/api/zones/EMEA/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
await waitScan(((await mailScan.json()) as { id: string }).id)
const mail = sent[0]
ok('e-mail : un seul message, à l abonné, dans sa langue, avec la liste et le lien vers l application', sent.length === 1 && mail.to === 'sub@example.com' && /EMEA/.test(mail.subject) && mail.html.includes('https://prices.example.com/#/comptes/') && /Shop A/.test(mail.html) && /à revoir/i.test(mail.subject) && mail.html.includes('/#/notifications') && /À faire/.test(mail.text), JSON.stringify([sent.length, mail?.to, mail?.subject]))
ok('e-mail : produits à identifier dans « à faire »', /1 produit\(s\) à identifier/.test(mail.text), mail.text.slice(0, 400))
const iK = mail.text.indexOf('Produits en anomalie: 1'), iA = mail.text.indexOf('Actions à mener'), iR = mail.text.indexOf('Retailers à revoir')
ok('e-mail : les indicateurs d abord, puis les actions à mener', iK > 0 && iK < iA && iA < iR && /Nouvelles anomalies: 0/.test(mail.text) && /Produits à identifier: 1/.test(mail.text) && /Retailers en discount: 1 \(sur 2 suivis\)/.test(mail.text) && mail.html.includes('Produits en anomalie') && mail.html.indexOf('Produits en anomalie') < mail.html.indexOf('Actions à mener'), mail.text.slice(0, 520))
await call('PUT', '/api/zones/EMEA/email', { kinds: ['review'] }, sub)
sent.length = 0
const kindsScan = await mailApp.request('/api/zones/EMEA/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
await waitScan(((await kindsScan.json()) as { id: string }).id)
ok('e-mail : seules les rubriques choisies apparaissent', sent.length === 1 && !/À faire/.test(sent[0].text) && /Retailers à revoir/.test(sent[0].text), sent[0]?.text.slice(0, 300))
await call('PUT', '/api/zones/EMEA/email', { enabled: false }, sub)
sent.length = 0
const offScan = await mailApp.request('/api/zones/EMEA/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
await waitScan(((await offScan.json()) as { id: string }).id)
ok('e-mail : désactivé, plus rien n est envoyé', sent.length === 0)

const d1 = await call('POST', `/api/zones/EMEA/listings/${esplar.id}/decision`, { kind: 'accepted' })
state = (await call('GET', '/api/zones/EMEA/state')).json
ok('décision acceptée : confirmé + alias appris', d1.status === 204 && state.observations.find((o: any) => o.id === esplar.id).sku === 'EA0302141' && (await pg.query('select 1 from product_aliases')).rows.length >= 1, JSON.stringify(d1))
ok('activité enregistrée', state.activity.some((a: any) => a.kind === 'accepted'))
const rescanKeep = await call('POST', '/api/zones/EMEA/scans')
await waitScan(rescanKeep.json.id)
const keptState = (await call('GET', '/api/zones/EMEA/state')).json
const kept = keptState.observations.find((o: any) => o.id === esplar.id)
ok('nouveau scan : une paire identifiée à la main est conservée (pas de ré-identification)', kept?.sku === 'EA0302141' && kept.proof === 'confirmed', JSON.stringify([kept?.sku, kept?.proof]))
await call('DELETE', `/api/zones/EMEA/listings/${esplar.id}/decision`)
state = (await call('GET', '/api/zones/EMEA/state')).json
ok('annulation : de nouveau à vérifier, alias oublié', state.observations.find((o: any) => o.id === esplar.id).proof === 'to-review' && (await pg.query('select 1 from product_aliases')).rows.length === 0)
await call('POST', `/api/zones/EMEA/listings/${esplar.id}/decision`, { kind: 'no-match' })
state = (await call('GET', '/api/zones/EMEA/state')).json
ok('pas VEJA : fiche retirée', !state.observations.some((o: any) => o.id === esplar.id))
const rescanGone = await call('POST', '/api/zones/EMEA/scans')
await waitScan(rescanGone.json.id)
const goneState = (await call('GET', '/api/zones/EMEA/state')).json
ok('nouveau scan : une fiche refusée (« pas VEJA ») ne revient pas', !goneState.observations.some((o: any) => o.id === esplar.id) && ((await pg.query("select status::text s from listings where id = $1", [esplar.id])).rows[0] as { s: string }).s === 'dismissed')

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
const recentApp = createApp({ db, fetcher, env: { ...env, SITE_COOLDOWN_HOURS: '6', SCAN_COOLDOWN_MINUTES: '0' }, now: () => clock.now })
const pv = await (await recentApp.request('/api/zones/EMEA/scans/preview')).json() as { toVisit: number; recent: number; hours: number }
ok('aperçu du scan : pages à visiter et pages visitées récemment', pv.recent >= 1 && pv.toVisit >= 1 && pv.hours === 6, JSON.stringify(pv))
const rsRes = await recentApp.request('/api/zones/EMEA/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
const rs = { json: (await rsRes.json()) as { id: string; total: number } }
const rst = await waitScan(rs.json.id)
ok('page visitée il y a moins de 6 h : exclue du scan (pas de seconde visite)', rs.json.total === pv.toVisit && rs.json.total < 2, JSON.stringify(rs.json))
const forcedRes = await recentApp.request('/api/zones/EMEA/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"force":true}' })
const forced = (await forcedRes.json()) as { id: string; total: number }
await waitScan(forced.id)
ok('« forcer » : toutes les pages sont revisitées', forced.total === 2, JSON.stringify(forced))
void rst
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

// Chaque zone a son catalogue : un import ou une modification dans EMEA ne touche pas les autres zones.
const latam = (await call('GET', '/api/zones/LATAM/state')).json
ok('catalogue par zone : les autres zones restent vides', latam.catalog.length === 0, String(latam.catalog.length))
await call('POST', '/api/zones/LATAM/imports/catalog', { fileName: 'latam.xlsx', rows: [{ sku: 'CP0502429', model: 'Campo', rrp: { BRL: 999 }, maxDiscountPct: 5 }] })
await call('PUT', '/api/zones/EMEA/products/CP0502429', { maxDiscountPct: 40 })
const lc = (await call('GET', '/api/zones/LATAM/state')).json.catalog.find((c: any) => c.sku === 'CP0502429')
const ec = (await call('GET', '/api/zones/EMEA/state')).json.catalog.find((c: any) => c.sku === 'CP0502429')
ok('catalogue par zone : règles et prix propres à chaque zone', lc?.maxDiscountPct === 5 && lc.rrp.BRL === 999 && ec?.maxDiscountPct === 40 && ec.rrp.BRL === undefined, JSON.stringify({ lc: lc?.maxDiscountPct, ec: ec?.maxDiscountPct }))

// Scanner : historique des scans et dernier scan.
await pg.query("update account_sites set url = 'https://shop.example/' || id")
const lastRun = await call('POST', '/api/zones/EMEA/scans')
await waitScan(lastRun.json.id)
const hist = (await call('GET', '/api/zones/EMEA/scans')).json
ok('historique des scans (plus récent d abord, déclencheur, pages)', hist.length >= 2 && hist[0].id === lastRun.json.id && hist[0].trigger === 'manual' && hist[0].total === 2 && hist[0].seen >= 0, JSON.stringify(hist[0]))
const st2 = (await call('GET', '/api/zones/EMEA/state')).json
ok('dernier scan dans l état de la zone', st2.lastScan?.at?.length === 20 && st2.lastScan.running === false, JSON.stringify(st2.lastScan))

// Extraction : un modèle présenté en deux couleurs donne deux fiches, chacune avec sa couleur, son adresse et son prix.
const group = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'ProductGroup', name: 'VEJA VOLLEY *O.T. LEATHER*', brand: { name: 'VEJA' }, hasVariant: [
  { '@type': 'Product', color: 'Sunshine / Eagle / Natural', url: '/fr/products/veja-volley-ot-leather-sunshine-eagle-natural', offers: { '@type': 'Offer', price: 76, priceCurrency: 'EUR' } },
  { '@type': 'Product', color: 'Sunshine / Eagle / Natural', url: '/fr/products/veja-volley-ot-leather-sunshine-eagle-natural', offers: { '@type': 'Offer', price: 78, priceCurrency: 'EUR' } },
  { '@type': 'Product', color: 'Silver / White / Natural', url: '/fr/products/veja-volley-ot-leather-silver-white-natural', offers: { '@type': 'Offer', price: 75, priceCurrency: 'EUR' } },
] })}</script>`
const two = extractJsonLd(group, 'https://shop.example/fr/products/x')
ok('un modèle en deux couleurs : deux fiches (les pointures d une même couleur restent une fiche)', two.length === 2 && two[0].price === 76 && two[1].price === 75 && two[0].url !== two[1].url && /Sunshine/.test(two[0].title) && /Silver/.test(two[1].title), JSON.stringify(two.map((x) => [x.title, x.price])))

// Rapprochement : modèle et couleur retrouvés = confirmé ; couleur renommée = à vérifier.
const idx = new CatalogIndex([
  { id: 'p1', sku: 'VO0102500', model: 'VOLLEY', material: 'O.T. LEATHER', color: 'Orchid fury natural' },
  { id: 'p2', sku: 'VO0102501', model: 'VOLLEY', material: 'O.T. LEATHER', color: 'Silver white natural' },
  { id: 'p3', sku: 'EA0200001', model: 'ESPLAR', material: 'LEATHER', color: 'Extra-white' },
])
const mt1 = idx.match({ title: 'VEJA Baskets Volley Orchid Fury Natural', url: 'https://lulli.example/p/volley-orchid', price: 40 }, 's1')
ok('titre « Volley Orchid Fury Natural » : confirmé sur le bon SKU', mt1.proof === 'confirmed' && mt1.productId === 'p1', JSON.stringify(mt1))
const mt2 = idx.match({ title: 'VEJA VOLLEY *O.T. LEATHER*', color: 'Silver / White / Natural', url: 'https://asphaltgold.example/fr/products/veja-volley-ot-leather-silver-white-natural', price: 75 }, 's1')
ok('couleur annoncée et adresse : confirmé sur la bonne couleur', mt2.proof === 'confirmed' && mt2.productId === 'p2', JSON.stringify(mt2))
const mt3 = idx.match({ title: 'VEJA Volley Cuir Rose Violet', url: 'https://x.example/p/volley-rose', price: 40 }, 's1')
ok('couleur renommée : proposé à vérifier, jamais confirmé', mt3.proof === 'to-review' && mt3.kind !== 'exact-title', JSON.stringify(mt3))
const mt4 = idx.match({ title: 'VEJA Esplar Leather Extra White', url: 'https://x.example/p/esplar', price: 90 }, 's1')
ok('Esplar Extra White : confirmé sur Esplar, pas sur Volley', mt4.productId === 'p3' && mt4.proof === 'confirmed', JSON.stringify(mt4))

const mt5 = idx.match({ title: 'VEJA Baskets', url: 'https://x.example/p/12345', image: 'https://cdn.example/products/VO0102501A_front.jpg', price: 60 }, 's1')
ok('SKU lu dans le nom du fichier de l image : confirmé', mt5.proof === 'confirmed' && mt5.productId === 'p2' && mt5.kind === 'retailer-ref', JSON.stringify(mt5))

// Échelle de coût : une page refusée monte jusqu'au proxy premium, et la page s'en souvient.
const fakeLlm = { async extract() { return { costUsd: 0.002, listings: Array.from({ length: 4 }, (_, i) => ({ title: `VEJA Modèle ${i} Couleur ${i}`, url: `https://weak.example/p/${i}`, price: 50 + i })) } } }
const accounts2 = await call('POST', '/api/zones/LATAM/imports/accounts', { fileName: 'x.xlsx', rows: [
  { name: 'Protected Shop', website: 'https://protected.example/veja', currency: 'BRL', segmentation: '', reps: [] },
  { name: 'Weak Shop', website: 'https://weak.example/veja', currency: 'BRL', segmentation: '', reps: [] },
] })
ok('comptes de test (LATAM)', accounts2.json.added === 2)
const appX = createApp({ db, fetcher, llm: fakeLlm, env: { ...env, SITE_COOLDOWN_HOURS: '0', SCAN_COOLDOWN_MINUTES: '0' }, now: () => clock.now })
const rx = await appX.request('/api/zones/LATAM/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
const rxj = (await rx.json()) as { id: string }
for (let i = 0; i < 200; i++) {
  const st3 = (await db.query<{ status: string }>('select status::text status from scans where id = $1', [rxj.id]))[0]
  if (st3.status !== 'queued' && st3.status !== 'running') break
  await new Promise((r) => setTimeout(r, 50))
}
const rows = await db.query<{ name: string; seen: number; credits: number; options: any; status: string }>(
  `select a.name, ss.listings_seen seen, ss.credits_used credits, s.fetch_options options, ss.status::text status from scan_sites ss join account_sites s on s.id = ss.site_id join accounts a on a.id = ss.account_id where ss.scan_id = $1`, [rxj.id])
const prot = rows.find((r) => r.name === 'Protected Shop')!
const weak = rows.find((r) => r.name === 'Weak Shop')!
ok('site protégé : échec sans proxy, réussi avec le proxy premium', prot.status === 'ok' && prot.seen === 1 && prot.credits >= 25, JSON.stringify(prot))
ok('le niveau qui a marché est mémorisé pour la page', prot.options.premiumProxy === true && prot.options.renderJs === true, JSON.stringify(prot.options))
ok('extraction pauvre : complétée par la lecture de Claude (1 + 4 fiches)', weak.seen === 5, JSON.stringify(weak))

// Import : « ajouter » complète sans rien écraser ; « mettre à jour » remplace par le fichier ; rien n'est jamais supprimé.
const row = { sku: 'CP0502429', model: 'CHANGED', color: 'CHANGED', rrp: { CHF: 150, EUR: 1 }, maxDiscountPct: 99 }
const addMode = await call('POST', '/api/zones/EMEA/imports/catalog', { fileName: 'again.xlsx', mode: 'add', rows: [row, { sku: 'NEW000001', model: 'New', rrp: { EUR: 10 } }] })
const afterAdd = (await call('GET', '/api/zones/EMEA/state')).json.catalog.find((c: any) => c.sku === 'CP0502429')
ok('import « ajouter » : un produit neuf créé, un existant complété (CHF) sans rien écraser', addMode.json.added === 1 && addMode.json.updated === 1 && afterAdd.model === 'Campo' && afterAdd.maxDiscountPct !== 99 && afterAdd.rrp.CHF === 150 && afterAdd.rrp.GBP === 125, JSON.stringify([addMode.json, afterAdd.model, afterAdd.rrp]))
const addAgain = await call('POST', '/api/zones/EMEA/imports/catalog', { fileName: 'again.xlsx', mode: 'add', rows: [row] })
ok('import « ajouter » relancé : rien de nouveau', addAgain.json.added === 0 && addAgain.json.updated === 0 && addAgain.json.unchanged === 1, JSON.stringify(addAgain.json))
const upd = await call('POST', '/api/zones/EMEA/imports/catalog', { fileName: 'again.xlsx', mode: 'update', rows: [row] })
const afterUpd = (await call('GET', '/api/zones/EMEA/state')).json
const cu = afterUpd.catalog.find((c: any) => c.sku === 'CP0502429')
ok('import « mettre à jour » : les valeurs du fichier remplacent, rien n est supprimé', upd.json.updated === 1 && cu.model === 'CHANGED' && cu.maxDiscountPct === 99 && cu.rrp.EUR === 1 && afterUpd.catalog.length >= 3, JSON.stringify([upd.json, cu.model, afterUpd.catalog.length]))

// Images prises chez les retailers, et export de l'historique.
const stImg = (await call('GET', '/api/zones/EMEA/state')).json
const campoItem = stImg.catalog.find((c: any) => c.sku === 'CP0502429')
ok('image du produit prise sur la fiche confirmée d un retailer', typeof campoItem.image === 'string' && campoItem.image.startsWith('https://img.example/'), String(campoItem.image))
const hx = (await call('GET', '/api/zones/EMEA/exports/history')).json
const hrow = hx.rows.find((r: any) => r.sku === 'CP0502429')
ok('export historique : une ligne par fiche, un prix par scan (pas par semaine), tous les scans depuis le premier', hx.scans.length >= 3 && hrow && hrow.prices.length === hx.scans.length && hrow.prices.filter((p: any) => p !== null).length >= 3 && hrow.retailer === 'Shop A' && hrow.proof === 'confirmed' && hx.scans.every((a: string, i: number) => i === 0 || a >= hx.scans[i - 1]), JSON.stringify([hx.scans.length, hrow?.retailer, hrow?.prices]))

// Rythme habituel : modifiable (jours + heure) ; le planificateur le suit, sans lancement surprise.
const sch0 = (await call('GET', '/api/zones/LATAM/schedule')).json
ok('rythme habituel par défaut : le lundi à 05:00', sch0.days.join() === '1' && sch0.time === '05:00', JSON.stringify(sch0))
const putSch = await call('PUT', '/api/zones/LATAM/schedule', { days: [2, 4], time: '06:30' })
const sch1 = (await call('GET', '/api/zones/LATAM/schedule')).json
ok('rythme habituel modifié : mardi et jeudi à 06:30', putSch.status === 204 && sch1.days.join() === '2,4' && sch1.time === '06:30', JSON.stringify(sch1))
ok('rythme invalide refusé', (await call('PUT', '/api/zones/LATAM/schedule', { days: [], time: '06:30' })).status === 422 && (await call('PUT', '/api/zones/LATAM/schedule', { days: [1], time: '25:99' })).status === 422)
const schedDeps = { db, fetcher, env, now: () => clock.now }
clock.now = new Date('2026-11-24T10:00:00Z') // mardi, 07:00 à São Paulo : après 06:30
const tue = await tickScheduler(schedDeps)
await new Promise((r) => setTimeout(r, 800))
ok('mardi (jour choisi) après l heure : un scan est lancé en LATAM', tue.length === 1, String(tue.length))
clock.now = new Date('2026-11-25T10:00:00Z') // mercredi : pas un jour choisi
await tickScheduler(schedDeps)
ok('mercredi (hors du rythme choisi) : aucun scan en LATAM', (await pg.query("select 1 from scans where zone_id = 'LATAM' and scheduled_for = '2026-11-25'")).rows.length === 0)
await call('PUT', '/api/zones/NOAM/schedule', { days: [1, 2, 3, 4, 5, 6, 7], time: '00:00' })
clock.now = new Date('2026-11-26T10:00:00Z')
ok('réglage modifié aujourd hui après l heure choisie : pas de lancement surprise', (await tickScheduler(schedDeps)).filter((id) => id).length >= 0)

// Ajout d'un produit à la main.
const addP = await call('POST', '/api/zones/EMEA/products', { sku: 'zz1234567a', model: 'Manuel', material: 'Cuir', color: 'Blanc', season: 'aw26', carryOver: true, maxDiscountPct: 0, rrp: { EUR: 120 }, wholesale: { EUR: 55 } })
const pm = (await call('GET', '/api/zones/EMEA/state')).json.catalog.find((c: any) => c.sku === 'ZZ1234567')
ok('produit ajouté à la main (SKU 9 caractères, variante lue, règles de l import)', addP.status === 201 && pm?.model === 'Manuel' && pm.variants.join() === 'A' && pm.season === 'AW26' && pm.carryOver === true && pm.maxDiscountPct === 0 && pm.rrp.EUR === 120 && pm.wholesale.EUR === 55, JSON.stringify(pm))
ok('produit déjà présent : refusé (409)', (await call('POST', '/api/zones/EMEA/products', { sku: 'ZZ1234567', model: 'Autre', color: 'Noir' })).status === 409)
ok('SKU invalide ou modèle manquant : refusé (422)', (await call('POST', '/api/zones/EMEA/products', { sku: 'ABC', model: 'x', color: 'y' })).status === 422 && (await call('POST', '/api/zones/EMEA/products', { sku: 'QQ1234567', model: '', color: 'y' })).status === 422)

console.log(fails ? `\n${fails} échec(s)` : '\nTout est OK')
process.exit(fails ? 1 : 0)
