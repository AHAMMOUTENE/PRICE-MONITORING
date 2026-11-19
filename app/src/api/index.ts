/**
 * Couche de données du front.
 *
 * `Api` est le contrat que le backend devra respecter. `mockApi` le remplit avec
 * des données de démonstration. Pour brancher le vrai service, écrire une autre
 * implémentation de `Api` et l'exporter à la place de `api`.
 */
import type {
  AccountComment,
  AccountProduct,
  Currency,
  ActivityItem,
  Alert,
  Anomaly,
  CatalogItem,
  ExportData,
  ExportFilters,
  FollowUpRow,
  GlobalOverview,
  GlobalProductDetail,
  GlobalProductRow,
  ZoneSummary,
  ImportOptions,
  ImportPreview,
  Observation,
  ProductDetail,
  ProductRow,
  Retailer,
  RetailerWeekRow,
  ReviewDecision,
  SessionUser,
  Rules,
  SalePeriod,
  ScanEstimate,
  ScanPlan,
  WeekOverview,
  WeekReport,
  Zone,
} from '../types'
import { currencyFromUrl } from '../lib/currencies'
import { ACCOUNT_COLUMNS, CATALOG_COLUMNS, mapColumns, parseAmount, prettyColor, priceColumns, readSheet, rrpColumns, seasonFromName, seasonalityOf, splitSku, UnsupportedFile, type Sheet } from '../lib/import-parse'
import { ZONES, zoneInfo } from '../lib/zones'
import { CATALOG, DEFAULT_RULES, OBSERVATIONS, RETAILERS, SALE_PERIODS, SEASON, WEEKS, addDays } from './mock-data'
import { createHttpApi, makeRequest } from './http'
import { discountAt, discountLimit, reasonAt, toAnomaly } from './rules'
import { countScanDays, isScanDay, isoWeekday } from './schedule'

export interface Api {
  /** La semaine demandée (par défaut la plus récente) : résumé et liste des comptes. */
  getWeek(zone: Zone, week?: string): Promise<WeekOverview>
  listAnomalies(zone: Zone, week: string, retailerId?: string): Promise<Anomaly[]>
  /** Tous les produits suivis chez un compte pour la semaine demandée : anomalies d'abord. */
  listAccountProducts(zone: Zone, retailerId: string, week: string): Promise<AccountProduct[]>
  /** Produits dont l'outil ne sait pas s'ils correspondent à un produit VEJA (file des « à identifier »). */
  listToIdentify(zone: Zone, retailerId?: string): Promise<(AccountProduct & { retailerName: string })[]>
  decideReview(id: string, decision: ReviewDecision): Promise<void>
  undoReview(id: string): Promise<void>
  /** Alertes à traiter, de la plus urgente à la moins urgente. */
  listAlerts(zone: Zone): Promise<Alert[]>
  /** L'utilisateur connecté : en production, l'identité vient du SSO. */
  getCurrentUser(): Promise<SessionUser>
  /** Commentaires laissés par l'équipe sur un compte, du plus récent au plus ancien. */
  listComments(retailerId: string): Promise<AccountComment[]>
  addComment(retailerId: string, text: string): Promise<AccountComment>
  /** Supprime un commentaire ; seul son auteur le peut. */
  removeComment(id: string): Promise<void>
  /** Le catalogue de la zone : chaque zone a ses produits, ses prix et ses règles par produit. */
  searchCatalog(zone: Zone, query: string): Promise<CatalogItem[]>
  listCatalog(zone: Zone): Promise<CatalogItem[]>
  /**
   * Modifie un produit du catalogue, champ par champ. `maxDiscountPct` absent = produit non contrôlé ;
   * `rrp` est fusionné devise par devise (une valeur absente retire le prix de cette devise).
   */
  updateProduct(zone: Zone, sku: string, patch: Partial<Omit<CatalogItem, 'sku'>>): Promise<void>
  listProducts(zone: Zone, week?: string): Promise<ProductRow[]>
  /** Un produit à travers ses comptes ; `week` (lundi) donne l'état de cette semaine-là, par défaut la plus récente. */
  getProduct(zone: Zone, sku: string, week?: string): Promise<ProductDetail | null>
  listHistory(zone: Zone): Promise<{ weeks: WeekReport[]; activity: ActivityItem[] }>
  buildExport(zone: Zone, filters: ExportFilters): Promise<ExportData>
  listRetailers(zone: Zone): Promise<Retailer[]>
  /** Devises des sites suivis dans la zone, la plus fréquente d'abord (au moins une : la devise par défaut de la zone). */
  listCurrencies(zone: Zone): Promise<Currency[]>
  saveRetailer(r: Retailer): Promise<Retailer>
  /** Coche ou décoche des comptes à suivre ; un compte non suivi n'est ni scanné ni affiché dans le suivi. */
  setTracked(ids: string[], tracked: boolean): Promise<void>
  removeRetailer(id: string): Promise<void>
  /** Lit le fichier (xlsx ou csv) et renvoie un aperçu ; rien n'est enregistré avant `commitImport`. */
  previewRetailerImport(file: File, zone: Zone, options?: ImportOptions): Promise<ImportPreview>
  previewCatalogImport(file: File, zone: Zone, options?: ImportOptions): Promise<ImportPreview>
  /** Applique un fichier prévisualisé. Renvoie le nombre de lignes importées. */
  commitImport(token: string): Promise<number>
  getRules(zone: Zone): Promise<Rules>
  saveRules(zone: Zone, rules: Rules): Promise<void>
  previewRules(zone: Zone, rules: Rules): Promise<{ confirmed: number; toReview: number; retailers: number }>
  listSalePeriods(zone: Zone): Promise<SalePeriod[]>
  addSalePeriod(p: Omit<SalePeriod, 'id'>): Promise<void>
  updateSalePeriod(id: string, p: Omit<SalePeriod, 'id' | 'zone'>): Promise<void>
  removeSalePeriod(id: string): Promise<void>
  /** Ce qu'un rythme de scan coûterait sur une période : scans et visites de sites de la zone. */
  estimateScans(zone: Zone, start: string, end: string, plan: ScanPlan): Promise<ScanEstimate>
  startScan(zone: Zone, onProgress: (done: number, total: number) => void): Promise<void>
  /** Vue globale, lecture seule : chaque zone résumée, et les produits (par SKU) à travers les zones. */
  getGlobalOverview(): Promise<GlobalOverview>
  getGlobalProduct(sku: string): Promise<GlobalProductDetail | null>
}

/** Date « du jour » de la démonstration. */
export let TODAY = '2026-11-18'

const delay = <T,>(v: T, ms = 120) => new Promise<T>((res) => setTimeout(() => res(v), ms))
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr')

let retailers: Retailer[] = RETAILERS.map((r) => ({ ...r, sites: [...r.sites] }))
/** Un catalogue par zone ; la démonstration n'en fournit un que pour EMEA, les autres zones importent le leur. */
const catalogs = new Map<Zone, CatalogItem[]>([['EMEA', CATALOG]])
function catalogFor(zone: Zone): CatalogItem[] {
  let list = catalogs.get(zone)
  if (!list) {
    list = []
    catalogs.set(zone, list)
  }
  return list
}
let salePeriods: SalePeriod[] = [...SALE_PERIODS]
const rulesByZone = new Map<Zone, Rules>()

/** Devises des sites de la zone, la plus fréquente d'abord ; la devise par défaut de la zone s'il n'y a aucun site. */
function zoneCurrencies(zone: Zone): Currency[] {
  const count = new Map<Currency, number>()
  for (const r of retailers) if (r.zone === zone) for (const s of r.sites) count.set(s.currency, (count.get(s.currency) ?? 0) + 1)
  const list = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c)
  return list.length ? list : [zoneInfo(zone).defaultCurrency]
}

interface ImportedAccount {
  name: string
  website: string
  currency: string
  segmentation: string
  reps: string[]
}
interface ImportedProduct {
  sku: string
  model: string
  material: string
  color: string
  season: string
  /** Indéfini quand le fichier ne dit rien de la saisonnalité : un réimport n'efface alors pas le drapeau. */
  carryOver?: boolean
  dept: string
  variants: string[]
  rrp: Partial<Record<Currency, number>>
  wholesale: Partial<Record<Currency, number>>
  maxDiscountPct?: number
  extra: Pick<CatalogItem, 'segmentation' | 'colorCode' | 'description' | 'composition' | 'origin' | 'ean'>
}
/** Fichiers lus mais pas encore appliqués, par jeton d'aperçu. */
type PendingImport = { kind: 'accounts'; zone: Zone; rows: ImportedAccount[] } | { kind: 'catalog'; zone: Zone; rows: ImportedProduct[] }
const pendingImports = new Map<string, PendingImport>()
/** Un seul aperçu en attente par type et par zone : un nouvel aperçu remplace l'ancien (pas de fuite, pas de jeton périmé applicable). */
function registerImport(entry: PendingImport): string {
  for (const [t, p] of pendingImports) if (p.kind === entry.kind && p.zone === entry.zone) pendingImports.delete(t)
  const token = `imp-${crypto.randomUUID()}`
  pendingImports.set(token, entry)
  return token
}
const decisions = new Map<string, ReviewDecision>()

/** L'utilisateur de la session. En production, il vient du SSO ; ici, un utilisateur fictif. */
const CURRENT_USER: SessionUser = { id: 'u-demo', name: 'Utilisateur démo' }

type StoredComment = Omit<AccountComment, 'mine'> & { byId: string }

/** Commentaires de démonstration, laissés par des collègues fictifs. */
let comments: StoredComment[] = [
  { id: 'cm-1', retailerId: 'r-asphaltgold', text: 'Appelé Jonas : les Campo repassent à prix plein cette semaine.', by: 'Camille Roux', byId: 'u-camille', at: '2026-11-02T10:15:00Z' },
  { id: 'cm-2', retailerId: 'r-asphaltgold', text: 'Toujours remisé le 9 : relancé par mail, copie à Marcel.', by: 'Alex Morel', byId: 'u-alex', at: '2026-11-09T16:40:00Z' },
  { id: 'cm-3', retailerId: 'r-sneakerienord', text: 'Le gérant dit que la remise vient d’un stock de l’an dernier.', by: 'Alex Morel', byId: 'u-alex', at: '2026-10-26T09:05:00Z' },
  { id: 'cm-4', retailerId: 'r-footshop', text: 'Mail envoyé au service web, réponse promise sous 48 h.', by: 'Camille Roux', byId: 'u-camille', at: '2026-11-12T11:30:00Z' },
  { id: 'cm-5', retailerId: 'r-deliberti', text: 'Contact pris : ils corrigent avant le Black Friday.', by: 'Alex Morel', byId: 'u-alex', at: '2026-11-16T14:20:00Z' },
]

const toComment = (c: StoredComment): AccountComment => ({ id: c.id, retailerId: c.retailerId, text: c.text, by: c.by, at: c.at, mine: c.byId === CURRENT_USER.id })

/** Commentaires d'un compte, du plus récent au plus ancien. */
function commentsFor(retailerId: string): AccountComment[] {
  return comments
    .filter((c) => c.retailerId === retailerId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(toComment)
}

let activity: ActivityItem[] = seedActivity()

function seedActivity(): ActivityItem[] {
  const names = new Map(RETAILERS.map((r) => [r.id, r.name]))
  const items: ActivityItem[] = []
  for (const c of comments) items.push({ id: `act-${c.id}`, at: c.at.slice(0, 10), kind: 'commented', title: '', retailerName: names.get(c.retailerId) ?? '', by: c.by, note: c.text })
  const sample = OBSERVATIONS.filter((o) => o.proof === 'confirmed' && o.history[o.history.length - 1].price < o.rrp).slice(0, 4)
  const dates = ['2026-11-12', '2026-11-10', '2026-11-09', '2026-11-05']
  sample.forEach((o, i) =>
    items.push({ id: `seed-${i}`, at: dates[i] ?? '2026-11-01', kind: 'accepted', title: o.title, retailerName: names.get(o.retailerId) ?? '', by: 'Camille Roux' }),
  )
  return items.sort((a, b) => b.at.localeCompare(a.at))
}

function rulesFor(zone: Zone): Rules {
  let r = rulesByZone.get(zone)
  if (!r) {
    r = { ...DEFAULT_RULES, excludedRetailerIds: [...DEFAULT_RULES.excludedRetailerIds] }
    rulesByZone.set(zone, r)
  }
  return r
}

/** Applique la décision humaine éventuelle à une observation. */
function resolve(zone: Zone, o: Observation): Observation | null {
  const d = decisions.get(o.id)
  if (!d) return o
  if (d.kind === 'no-match') return null
  if (d.kind === 'accepted' && o.candidate) {
    return { ...o, proof: 'confirmed', sku: o.candidate.sku, candidate: undefined }
  }
  if (d.kind === 'corrected') {
    const item = catalogFor(zone).find((c) => c.sku === d.sku)
    if (item) {
      return { ...o, proof: 'confirmed', sku: item.sku, model: item.model, color: item.color, rrp: item.rrp[o.currency] ?? o.rrp, candidate: undefined }
    }
  }
  return o
}

function scannable(zone: Zone): Map<string, Retailer> {
  return new Map(retailers.filter((r) => r.zone === zone && r.tracked && r.sites.length > 0).map((r) => [r.id, r]))
}

function anomaliesFor(zone: Zone, weekIdx: number, rules: Rules = rulesFor(zone)): Anomaly[] {
  const byId = scannable(zone)
  const out: Anomaly[] = []
  for (const raw of OBSERVATIONS) {
    const retailer = byId.get(raw.retailerId)
    if (!retailer || rules.excludedRetailerIds.includes(retailer.id)) continue
    const o = resolve(zone, raw)
    if (!o) continue
    const a = toAnomaly(o, retailer, weekIdx, itemFor(zone, o))
    if (!a) continue
    if (a.proof === 'to-review' && a.candidate) {
      const item = catalogFor(zone).find((c) => c.sku === a.candidate!.sku)
      if (item) a.proposal = { item, confidence: a.candidate.confidence }
    }
    out.push(a)
  }
  return out
}

/** Observations de la zone, décisions humaines appliquées, avec leur SKU effectif. */
function observationsFor(zone: Zone): { o: Observation; retailer: Retailer; sku: string }[] {
  const byId = scannable(zone)
  const out: { o: Observation; retailer: Retailer; sku: string }[] = []
  for (const raw of OBSERVATIONS) {
    const retailer = byId.get(raw.retailerId)
    const o = retailer ? resolve(zone, raw) : null
    const sku = o ? (o.sku ?? o.candidate?.sku) : undefined
    if (retailer && o && sku) out.push({ o, retailer, sku })
  }
  return out
}

/** Le produit du catalogue auquel une observation est rattachée (SKU confirmé, sinon SKU proposé). */
function itemFor(zone: Zone, o: Observation): CatalogItem | undefined {
  const sku = o.sku ?? o.candidate?.sku
  return sku ? catalogFor(zone).find((c) => c.sku === sku) : undefined
}

function weekIndex(week?: string): number {
  const i = week ? WEEKS.indexOf(week) : -1
  return i >= 0 ? i : WEEKS.length - 1
}

/** Semaines sans anomalie entre deux périodes d'anomalie, si l'anomalie actuelle est un retour. */
function recurrenceGap(trend: number[]): number | undefined {
  const last = trend.length - 1
  if (trend[last] === 0) return undefined
  let k = last
  while (k >= 0 && trend[k] > 0) k--
  if (k < 0) return undefined
  let gap = 0
  while (k >= 0 && trend[k] === 0) {
    gap++
    k--
  }
  return k >= 0 && trend[k] > 0 ? gap : undefined
}

/** Tous les produits suivis chez un compte pour une semaine : anomalies d'abord. */
function accountProductsFor(zone: Zone, retailerId: string, idx: number): AccountProduct[] {
  const rules = rulesFor(zone)
  const retailer = scannable(zone).get(retailerId)
  if (!retailer) return []
  const out: AccountProduct[] = []
  for (const raw of OBSERVATIONS) {
    if (raw.retailerId !== retailerId) continue
    const o = resolve(zone, raw)
    if (!o) continue
    const item = itemFor(zone, o)
    const an = rules.excludedRetailerIds.includes(retailer.id) ? null : toAnomaly(o, retailer, idx, item)
    const proposal =
      o.proof === 'to-review' && o.candidate
        ? (() => {
            const item = catalogFor(zone).find((c) => c.sku === o.candidate!.sku)
            return item ? { item, confidence: o.candidate!.confidence } : undefined
          })()
        : undefined
    const price = o.history[idx].price
    out.push({
      ...o,
      salePrice: price,
      discountPct: discountAt(o, idx),
      reason: an ? an.reason : null,
      discountLimitPct: discountLimit(item),
      change: idx > 0 ? Math.round((price - o.history[idx - 1].price) * 100) / 100 : 0,
      consecutiveChecks: an ? an.consecutiveChecks : 0,
      firstSeen: an?.firstSeen,
      proposal,
    })
  }
  out.sort(
    (x, y) =>
      (x.reason ? 0 : 1) - (y.reason ? 0 : 1) ||
      (x.proof === y.proof ? 0 : x.proof === 'to-review' ? -1 : 1) ||
      y.discountPct - x.discountPct ||
      x.title.localeCompare(y.title, 'fr'),
  )
  return out
}

const STATUS_RANK = { anomaly: 0, ok: 1, 'no-site': 2, excluded: 3 } as const

function buildRows(zone: Zone, idx: number): RetailerWeekRow[] {
  const excluded = rulesFor(zone).excludedRetailerIds
  const inZone = retailers.filter((r) => r.zone === zone && r.tracked)
  const byId = scannable(zone)
  const perWeek = WEEKS.map((_, i) => anomaliesFor(zone, i))
  const anomalies = perWeek[idx]
  const scanned = new Map<string, number>()
  for (const o of OBSERVATIONS) if (byId.has(o.retailerId)) scanned.set(o.retailerId, (scanned.get(o.retailerId) ?? 0) + 1)

  return inZone
    .map((r): RetailerWeekRow => {
      const list = anomalies.filter((a) => a.retailerId === r.id)
      const confirmed = list.filter((a) => a.proof === 'confirmed').length
      const trend = perWeek.map((l) => l.filter((a) => a.retailerId === r.id && a.proof === 'confirmed').length)
      const own = commentsFor(r.id)
      return {
        retailer: r,
        status: excluded.includes(r.id) ? 'excluded' : r.sites.length === 0 ? 'no-site' : list.length > 0 ? 'anomaly' : 'ok',
        scanned: scanned.get(r.id) ?? 0,
        confirmed,
        toReview: list.length - confirmed,
        worstDiscountPct: list.length ? Math.max(...list.map((a) => a.discountPct)) : 0,
        previews: [...list]
          .sort((x, y) => (x.proof === y.proof ? 0 : x.proof === 'confirmed' ? -1 : 1) || y.discountPct - x.discountPct)
          .slice(0, 3)
          .map((a) => ({ sku: a.sku ?? a.proposal?.item.sku, color: a.color, title: a.title, image: a.image })),
        trend,
        comments: own.length,
        lastComment: own[0],
      }
    })
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.confirmed - a.confirmed || b.toReview - a.toReview || byName(a.retailer, b.retailer),
    )
}

/** Prochain jour de scan après aujourd'hui : un jour de scan d'une période de soldes, sinon le lundi suivant. */
function nextScanDate(zone: Zone): string {
  const periods = salePeriods.filter((p) => p.zone === zone)
  for (let i = 1; i <= 120; i++) {
    const d = addDays(TODAY, i)
    const p = periods.find((x) => x.start <= d && d <= x.end)
    if (p ? isScanDay(d, p.scan) : isoWeekday(d) === 1) return d
  }
  return addDays(TODAY, 7)
}

export const mockApi: Api = {
  async getWeek(zone, week) {
    const idx = weekIndex(week)
    const perWeek = WEEKS.map((_, i) => anomaliesFor(zone, i))
    const anomalies = perWeek[idx]
    const previous = idx > 0 ? perWeek[idx - 1] : null
    const rows = buildRows(zone, idx)
    const confirmed = anomalies.filter((a) => a.proof === 'confirmed').length
    const sales = salePeriods.filter((p) => p.zone === zone)
    return delay({
      weekOf: WEEKS[idx],
      weeks: [...WEEKS].reverse(),
      weekStats: WEEKS.map((w, i) => ({ week: w, confirmed: perWeek[i].filter((a) => a.proof === 'confirmed').length })).reverse(),
      isCurrent: idx === WEEKS.length - 1,
      confirmed,
      toReview: anomalies.length - confirmed,
      retailersInAnomaly: rows.filter((r) => r.confirmed > 0).length,
      deltaConfirmed: previous ? confirmed - previous.filter((a) => a.proof === 'confirmed').length : null,
      nextScan: nextScanDate(zone),
      currentSale: sales.find((p) => p.start <= TODAY && TODAY <= p.end) ?? null,
      retailers: rows,
    })
  },

  async listAnomalies(zone, week, retailerId) {
    const list = anomaliesFor(zone, weekIndex(week))
      .filter((a) => !retailerId || a.retailerId === retailerId)
      .sort((a, b) => (a.proof === b.proof ? 0 : a.proof === 'to-review' ? -1 : 1) || b.discountPct - a.discountPct)
    return delay(list)
  },

  async listAccountProducts(zone, retailerId, week) {
    return delay(accountProductsFor(zone, retailerId, weekIndex(week)))
  },

  async listToIdentify(zone, retailerId) {
    const idx = WEEKS.length - 1
    const out: (AccountProduct & { retailerName: string })[] = []
    for (const r of scannable(zone).values()) {
      if (retailerId && r.id !== retailerId) continue
      for (const p of accountProductsFor(zone, r.id, idx)) {
        if (p.proof === 'to-review' && p.reason) out.push({ ...p, retailerName: r.name })
      }
    }
    out.sort((x, y) => (y.proposal?.confidence ?? 0) - (x.proposal?.confidence ?? 0) || x.retailerName.localeCompare(y.retailerName, 'fr'))
    return delay(out)
  },

  async decideReview(id, decision) {
    decisions.set(id, decision)
    const raw = OBSERVATIONS.find((o) => o.id === id)
    if (raw) {
      activity = [
        { id: `act-${id}`, at: TODAY, kind: decision.kind, title: raw.title, retailerName: retailers.find((r) => r.id === raw.retailerId)?.name ?? '', by: CURRENT_USER.name },
        ...activity.filter((a) => a.id !== `act-${id}`),
      ]
    }
    return delay(undefined, 60)
  },

  async undoReview(id) {
    decisions.delete(id)
    activity = activity.filter((a) => a.id !== `act-${id}`)
    return delay(undefined, 60)
  },

  async listAlerts(zone) {
    const rows = buildRows(zone, WEEKS.length - 1)
    const alerts: Alert[] = []
    for (const r of rows) {
      const weeks = (() => {
        let n = 0
        for (let i = r.trend.length - 1; i >= 0 && r.trend[i] > 0; i--) n++
        return n
      })()
      const base = { retailerId: r.retailer.id, retailerName: r.retailer.name, weeks }
      if (r.status === 'excluded') continue
      if (r.status === 'no-site') {
        alerts.push({ ...base, id: `${r.retailer.id}:site`, kind: 'site-missing', products: 0 })
        continue
      }
      if (r.toReview > 0) alerts.push({ ...base, id: `${r.retailer.id}:review`, kind: 'to-review', products: r.toReview })
      const gap = recurrenceGap(r.trend)
      if (gap !== undefined) alerts.push({ ...base, id: `${r.retailer.id}:recurrence`, kind: 'recurrence', products: r.confirmed, gapWeeks: gap })
    }
    const rank: Record<Alert['kind'], number> = { 'to-review': 0, recurrence: 1, 'site-missing': 2 }
    alerts.sort((a, b) => rank[a.kind] - rank[b.kind] || b.products - a.products || a.retailerName.localeCompare(b.retailerName, 'fr'))
    return delay(alerts)
  },

  async getCurrentUser() {
    return delay(CURRENT_USER, 30)
  },

  async listComments(retailerId) {
    return delay(commentsFor(retailerId), 60)
  },

  async addComment(retailerId, text) {
    const clean = text.trim()
    const stored: StoredComment = {
      id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      retailerId,
      text: clean,
      by: CURRENT_USER.name,
      byId: CURRENT_USER.id,
      at: `${TODAY}T${new Date().toISOString().slice(11)}`, // le jour de la démonstration, à l'heure réelle
    }
    comments = [...comments, stored]
    const name = retailers.find((r) => r.id === retailerId)?.name ?? ''
    activity = [{ id: `act-${stored.id}`, at: TODAY, kind: 'commented', title: '', retailerName: name, by: CURRENT_USER.name, note: clean }, ...activity]
    return delay(toComment(stored), 80)
  },

  async removeComment(id) {
    const mine = comments.some((c) => c.id === id && c.byId === CURRENT_USER.id)
    if (!mine) return delay(undefined, 60) // le commentaire d'un collègue reste intact
    comments = comments.filter((c) => c.id !== id)
    activity = activity.filter((a) => a.id !== `act-${id}`)
    return delay(undefined, 60)
  },

  async searchCatalog(zone, query) {
    const q = query.trim().toLowerCase()
    if (!q) return delay([], 40)
    return delay(catalogFor(zone).filter((c) => `${c.sku} ${c.model} ${c.material} ${c.color}`.toLowerCase().includes(q)).slice(0, 6), 60)
  },

  async listCatalog(zone) {
    return delay(catalogFor(zone))
  },

  async listCurrencies(zone) {
    return delay(zoneCurrencies(zone), 30)
  },

  async updateProduct(zone, sku, patch) {
    const item = catalogFor(zone).find((c) => c.sku === sku)
    if (!item) return delay(undefined, 40)
    for (const key of ['model', 'material', 'color', 'dept', 'season'] as const) if (patch[key] !== undefined) item[key] = patch[key]
    for (const key of ['segmentation', 'colorCode', 'description', 'composition', 'origin', 'ean'] as const) {
      if (!(key in patch)) continue
      if (patch[key]) item[key] = patch[key]
      else delete item[key]
    }
    if ('maxDiscountPct' in patch) {
      if (patch.maxDiscountPct === undefined) delete item.maxDiscountPct
      else item.maxDiscountPct = patch.maxDiscountPct
    }
    if (patch.wholesale) {
      for (const [cur, v] of Object.entries(patch.wholesale)) {
        if (v === undefined) delete item.wholesale[cur]
        else item.wholesale[cur] = v
      }
    }
    if ('carryOver' in patch) {
      if (patch.carryOver) item.carryOver = true
      else delete item.carryOver
    }
    if (patch.rrp) {
      for (const [cur, v] of Object.entries(patch.rrp)) {
        if (v === undefined) delete item.rrp[cur]
        else item.rrp[cur] = v
      }
    }
    return delay(undefined, 80)
  },

  async listProducts(zone, week) {
    const idx = weekIndex(week)
    const rules = rulesFor(zone)
    const groups = new Map<string, { o: Observation; retailer: Retailer }[]>()
    for (const { o, retailer, sku } of observationsFor(zone)) groups.set(sku, [...(groups.get(sku) ?? []), { o, retailer }])
    const rows: ProductRow[] = []
    for (const [sku, list] of groups) {
      const item = catalogFor(zone).find((c) => c.sku === sku)
      if (!item) continue
      const counted = list.filter(({ retailer }) => !rules.excludedRetailerIds.includes(retailer.id)) // un compte exclu ne compte ni dans le pire prix ni dans le nombre de comptes
      if (counted.length === 0) continue
      const flagged = counted.filter(({ o }) => reasonAt(o, idx, item))
      // Le pire cas : le compte le plus remisé, dans la devise de son site (les sites d'une zone peuvent différer).
      const worst = counted.reduce((a, b) => (discountAt(b.o, idx) > discountAt(a.o, idx) ? b : a))
      const currency = worst.o.currency
      rows.push({
        sku,
        item,
        currency,
        rrp: item.rrp[currency] ?? worst.o.rrp,
        accounts: new Set(counted.map((x) => x.retailer.id)).size,
        lowest: worst.o.history[idx].price,
        worstDiscountPct: discountAt(worst.o, idx),
        anomalies: flagged.length,
        toReview: flagged.filter(({ o }) => o.proof === 'to-review').length,
      })
    }
    rows.sort((a, b) => b.anomalies - a.anomalies || b.worstDiscountPct - a.worstDiscountPct || a.item.model.localeCompare(b.item.model, 'fr'))
    return delay(rows)
  },

  async getProduct(zone, sku, week) {
    const rules = rulesFor(zone)
    const last = weekIndex(week)
    const list = observationsFor(zone).filter((x) => x.sku === sku)
    const item = catalogFor(zone).find((c) => c.sku === sku)
    if (!item || list.length === 0) return delay(null)
    const count = new Map<Currency, number>()
    for (const { o } of list) count.set(o.currency, (count.get(o.currency) ?? 0) + 1)
    const currencies = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c)
    return delay({
      item,
      discountLimitPct: discountLimit(item),
      currencies,
      weeks: [...WEEKS],
      series: list
        .map(({ o, retailer }) => ({
          retailerId: retailer.id,
          retailerName: retailer.name,
          currency: o.currency,
          rrp: item.rrp[o.currency] ?? o.rrp,
          points: o.history,
          currentPrice: o.history[last].price,
          discountPct: discountAt(o, last),
          change: last > 0 ? Math.round((o.history[last].price - o.history[last - 1].price) * 100) / 100 : 0,
          anomaly: !rules.excludedRetailerIds.includes(retailer.id) && reasonAt(o, last, item) !== null,
          proof: o.proof,
          url: o.url,
        }))
        // Les devises peuvent différer d'un compte à l'autre : on classe par remise, pas par prix.
        .sort((a, b) => b.discountPct - a.discountPct || a.retailerName.localeCompare(b.retailerName, 'fr')),
    })
  },

  async listHistory(zone) {
    const weeks: WeekReport[] = WEEKS.map((w, i) => {
      const list = anomaliesFor(zone, i)
      return {
        weekOf: w,
        confirmed: list.filter((a) => a.proof === 'confirmed').length,
        toReview: list.filter((a) => a.proof === 'to-review').length,
        accountsInAnomaly: new Set(list.filter((a) => a.proof === 'confirmed').map((a) => a.retailerId)).size,
      }
    }).reverse()
    return delay({ weeks, activity })
  },

  async buildExport(zone, filters) {
    const weeks = WEEKS.filter((w) => w >= filters.fromWeek && w <= filters.toWeek)
    const keep = (a: Anomaly) =>
      (filters.retailerIds.length === 0 || filters.retailerIds.includes(a.retailerId)) &&
      (filters.proof === 'all' || a.proof === filters.proof) &&
      (!filters.productIds || filters.productIds.includes(a.id))

    // Le fichier suit le format de l'entreprise, en anglais, quelle que soit la langue de l'interface.
    const detailHeader = [
      'Week', 'Account', 'Segmentation', 'Sales rep', 'URL', 'Product', 'SKU', 'Model', 'Color', 'Season',
      'Currency', 'RRP', 'Struck price', 'Site price', 'Observed discount',
      'Allowed discount', 'Reason', 'Proof', 'Consecutive weeks', 'First seen',
    ]
    const detailRows: (string | number | null)[][] = []
    for (const week of weeks) {
      for (const a of anomaliesFor(zone, WEEKS.indexOf(week)).filter(keep)) {
        detailRows.push([
          week, a.retailerName, a.segmentation, a.salesReps.join(', '), a.url, a.title, a.sku ?? '', a.model, a.color, itemFor(zone, a)?.season ?? '',
          a.currency, a.rrp, a.originalPrice ?? null, a.salePrice, a.discountPct / 100, a.discountLimitPct / 100,
          a.reason === 'non-discounted-model' ? 'Not discounted product' : 'Discount above allowed',
          a.proof === 'confirmed' ? 'Confirmed' : 'To validate', a.consecutiveChecks, a.firstSeen,
        ])
      }
    }

    const lastWeek = weeks[weeks.length - 1] ?? WEEKS[WEEKS.length - 1]
    const atLast = anomaliesFor(zone, WEEKS.indexOf(lastWeek)).filter(keep)
    const summary: FollowUpRow[] = retailers
      .filter((r) => r.zone === zone)
      .filter((r) => filters.retailerIds.length === 0 || filters.retailerIds.includes(r.id))
      .filter((r) => r.tracked && !rulesFor(zone).excludedRetailerIds.includes(r.id)) // seuls les comptes scannés et contrôlés figurent dans le fichier
      .filter((r) => !filters.productIds || atLast.some((a) => a.retailerId === r.id))
      .sort(byName)
      .map((r) => {
        const confirmed = atLast.filter((a) => a.retailerId === r.id && a.proof === 'confirmed')
        const discounts = confirmed.map((a) => a.discountPct / 100)
        return {
          name: r.name,
          website: r.sites[0]?.url ?? '',
          segmentation: r.segmentation,
          salesReps: r.salesReps.join(', '),
          onAnomaly: confirmed.length > 0,
          skuCount: new Set(confirmed.map((a) => a.sku ?? a.id)).size,
          avgDiscount: discounts.length ? discounts.reduce((s, d) => s + d, 0) / discounts.length : null,
          // Les commentaires de l'équipe, du plus récent au plus ancien ; à défaut, les modèles concernés.
          comments:
            commentsFor(r.id)
              .map((c) => `${c.text} (${c.by}, ${c.at.slice(0, 10)})`)
              .join(' | ') || [...new Set(confirmed.map((a) => a.model))].sort((x, y) => x.localeCompare(y, 'fr')).join(', '),
        }
      })

    return delay(
      { season: SEASON, zone, weekOf: lastWeek, summary, detailHeader, detailRows, fileName: weeks.length > 1 ? `FOLLOW_UP_IMAGE_ONLINE_${SEASON}_${zone}_${weeks[0]}_to_${lastWeek}.xlsx` : `FOLLOW_UP_IMAGE_ONLINE_${SEASON}_${zone}_${lastWeek}.xlsx` },
      250,
    )
  },

  async listRetailers(zone) {
    return delay(retailers.filter((r) => r.zone === zone).sort(byName))
  },

  async saveRetailer(r) {
    const exists = retailers.some((x) => x.id === r.id)
    const saved = exists ? r : { ...r, id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
    retailers = exists ? retailers.map((x) => (x.id === r.id ? saved : x)) : [...retailers, saved]
    return delay(saved, 80)
  },

  async setTracked(ids, tracked) {
    const set = new Set(ids)
    retailers = retailers.map((r) => (set.has(r.id) ? { ...r, tracked } : r))
    return delay(undefined, 60)
  },

  async removeRetailer(id) {
    retailers = retailers.filter((r) => r.id !== id)
    return delay(undefined, 60)
  },

  async previewRetailerImport(file, zone, options) {
    const base = { token: '', fileName: file.name, rows: 0, recognized: [], warnings: [], canImport: false, sample: [], header: ['col.account', 'col.site', 'col.currency', 'col.segmentation', 'col.rep'] }
    let sheet: Sheet
    try {
      sheet = await readSheet(file, { delimiter: options?.delimiter, sheet: options?.sheet, expected: Object.values(ACCOUNT_COLUMNS).flat() })
    } catch (e) {
      return { ...base, warnings: [{ kind: e instanceof UnsupportedFile && e.reason === 'xlsOld' ? 'xlsOld' : 'unsupported', n: 0 }] }
    }
    const cols = { ...mapColumns(sheet.header, ACCOUNT_COLUMNS), ...(options?.mapping ?? {}) }
    const mapped = { fileColumns: sheet.header, mapping: cols, delimiter: sheet.delimiter, sheets: sheet.sheets.length > 1 ? sheet.sheets : undefined, sheet: sheet.sheet }
    if (cols.name < 0) return { ...base, ...mapped, warnings: [{ kind: 'missingColumn', n: 0, column: 'STORE NAME' }] }
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
    const { defaultCurrency } = zoneInfo(zone)
    const seen = new Set<string>()
    const rows: ImportedAccount[] = []
    let skipped = 0
    sheet.rows.forEach((r, idx) => {
      const name = get(r, cols.name)
      if (!name || seen.has(name.toLowerCase())) return
      // Le fichier de suivi porte le site en lien sur le nom du compte ; un lien cassé (titre de page) ne vaut pas une adresse.
      const linked = sheet.links[idx]?.[cols.name]
      const raw = get(r, cols.website) || linked || ''
      const website = /^https?:\/\//i.test(raw) ? raw : ''
      const segmentation = get(r, cols.segmentation)
      const reps = get(r, cols.rep).split(/[,;/]/).map((x) => x.trim()).filter(Boolean)
      if (!website && !segmentation && reps.length === 0) {
        skipped++ // ligne de total (« 26 shops ») ou vide
        return
      }
      seen.add(name.toLowerCase())
      rows.push({
        name,
        website,
        // Sans colonne devise, l'adresse donne un indice (.co.uk → GBP) ; sinon la devise proposée par la zone.
        // Une devise du fichier n'est retenue que si c'est un code ISO (« EUR ») ; « euro » ou « € » retombent sur l'indice de l'adresse.
        currency: (/^[A-Z]{3}$/.test(get(r, cols.currency).toUpperCase()) ? get(r, cols.currency).toUpperCase() : '') || (website ? currencyFromUrl(website, defaultCurrency) : ''),
        segmentation,
        reps,
      })
    })
    if (rows.length === 0) return { ...base, ...mapped, warnings: [{ kind: 'empty', n: 0 }] }
    const missing = rows.filter((r) => !r.website).length
    const token = registerImport({ kind: 'accounts', zone, rows })
    return delay(
      {
        ...base,
        token,
        skipped: skipped || undefined,
        ...mapped,
        rows: rows.length,
        recognized: [],
        warnings: missing ? [{ kind: 'noSite' as const, n: missing }] : [],
        canImport: true,
        sample: rows.map((r) => [r.name, r.website, r.currency, r.segmentation, r.reps.join(', ')]),
      },
      200,
    )
  },

  async previewCatalogImport(file, zone, options) {
    const currencies = zoneCurrencies(zone)
    const currency = currencies[0]
    const base = { token: '', fileName: file.name, rows: 0, recognized: [], warnings: [], canImport: false, sample: [], header: ['col.sku', 'col.model', 'col.material', 'col.color', 'col.season', 'col.rrp'] }
    let sheet: Sheet
    try {
      sheet = await readSheet(file, { delimiter: options?.delimiter, sheet: options?.sheet, expected: [...Object.values(CATALOG_COLUMNS).flat(), 'rrp'] })
    } catch (e) {
      return { ...base, warnings: [{ kind: e instanceof UnsupportedFile && e.reason === 'xlsOld' ? 'xlsOld' : 'unsupported', n: 0 }] }
    }
    const cols = { ...mapColumns(sheet.header, CATALOG_COLUMNS), ...(options?.mapping ?? {}) }
    const mapped = { fileColumns: sheet.header, mapping: cols, delimiter: sheet.delimiter, sheets: sheet.sheets.length > 1 ? sheet.sheets : undefined, sheet: sheet.sheet }
    const rrpCols = rrpColumns(sheet.header, currency) // une colonne par devise : « RRP EUR », « RRP GBP »…
    const whsCols = priceColumns(sheet.header, currency, 'wholesale') // « UNIT PRICE EUR », « WHS GBP »…
    if (cols.sku < 0) return { ...base, ...mapped, warnings: [{ kind: 'missingColumn', n: 0, column: 'SKU' }] }
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
    // La saison vient de l'utilisateur, sinon du nom de l'onglet ou du fichier (« AW26 CARRY OVER LIST » → AW26).
    const season = (options?.season ?? seasonFromName(sheet.sheet, file.name)).toUpperCase()
    // Une « CARRY OVER LIST » est, pour l'équipe, la liste des produits à ne pas solder : tout le fichier passe en non soldé, sauf avis contraire.
    // Classeur à plusieurs onglets : seul le nom de l'onglet compte (le MASTERFILE du même fichier n'est pas une liste carry-over).
    const noDiscount = options?.noDiscount ?? /carry\s*over\s*list/i.test(sheet.sheets.length > 1 ? (sheet.sheet ?? '') : `${sheet.sheet ?? ''} ${file.name}`)
    const seen = new Map<string, ImportedProduct>()
    const rows: ImportedProduct[] = []
    let badPrice = 0
    for (const r of sheet.rows) {
      const rawSku = get(r, cols.sku)
      if (!rawSku) continue
      // Fichiers VEJA : une ligne par taille et par variante (A/B/C/D) ; l'identité est le SKU sur 9 caractères.
      const { sku, variant } = splitSku(rawSku, get(r, cols.generic) || get(r, cols.reference))
      const already = seen.get(sku)
      if (already) {
        if (variant && !already.variants.includes(variant)) already.variants.push(variant)
        continue
      }
      const rrp: Partial<Record<Currency, number>> = {}
      for (const [cur, i] of Object.entries(rrpCols)) {
        const raw = get(r, i)
        const v = parseAmount(raw)
        if (v !== undefined) rrp[cur] = v
        else if (raw) badPrice++
      }
      const wholesale: Partial<Record<Currency, number>> = {}
      for (const [cur, i] of Object.entries(whsCols)) {
        const v = parseAmount(get(r, i))
        if (v !== undefined) wholesale[cur] = Math.round(v * 100) / 100
      }
      const extra = { segmentation: get(r, cols.segmentation), colorCode: get(r, cols.colorCode), description: get(r, cols.description), composition: get(r, cols.composition), origin: get(r, cols.origin), ean: get(r, cols.ean) }
      // « CARRY OVER » peut être dans une colonne SEASONALITY, ou dans la colonne SEASON des fichiers récents.
      const seasonCell = get(r, cols.season)
      const seasonality = seasonalityOf(get(r, cols.seasonality)) ?? seasonalityOf(seasonCell)
      const carryOver = seasonality === null ? undefined : seasonality === 'carry-over'
      const own = parseAmount(get(r, cols.maxDiscount))
      const row: ImportedProduct = {
        sku,
        variants: variant ? [variant] : [],
        model: get(r, cols.model),
        material: get(r, cols.material),
        color: prettyColor(get(r, cols.color)),
        season: (seasonalityOf(seasonCell) ? '' : seasonCell.toUpperCase()) || season,
        carryOver,
        dept: get(r, cols.dept),
        rrp,
        wholesale,
        extra,
        // Règle du produit : la colonne « MAX DISCOUNT % » si elle existe ; sinon non soldé (0) pour un carry-over ou toute la liste ; sinon pas de règle (non contrôlé).
        maxDiscountPct: own !== undefined ? own : carryOver || noDiscount ? 0 : undefined,
      }
      seen.set(sku, row)
      rows.push(row)
    }
    if (rows.length === 0) return { ...base, ...mapped, season, noDiscount, warnings: [{ kind: 'empty', n: 0 }] }
    const warnings: ImportPreview['warnings'] = []
    // Un avertissement par devise utilisée dans la zone : un produit sans RRP dans une devise ne peut pas y être contrôlé.
    for (const cur of currencies) {
      const withoutPrice = rows.filter((p) => p.rrp[cur] === undefined).length
      if (withoutPrice) warnings.push({ kind: 'noPrice', n: withoutPrice, currency: cur })
    }
    if (badPrice) warnings.push({ kind: 'badPrice', n: badPrice })
    const token = registerImport({ kind: 'catalog', zone, rows })
    return delay(
      {
        ...base,
        token,
        season,
        noDiscount,
        ...mapped,
        rows: rows.length,
        recognized: [
          ...Object.entries(whsCols).map(([cur, i]) => ({ key: 'wholesale', from: sheet.header[i], label: `WHS ${cur}` })),
          ...Object.entries(rrpCols).map(([cur, i]) => ({ key: 'rrp', from: sheet.header[i], label: `RRP ${cur}` })),
        ],
        warnings,
        canImport: true,
        sample: rows.map((p) => [p.sku, p.model, p.material, p.color, `${p.season}${p.carryOver ? ' · C/O' : ''}`, p.rrp[currency] !== undefined ? `${p.rrp[currency]} ${currency}` : '']),
      },
      200,
    )
  },

  async commitImport(token) {
    const pending = pendingImports.get(token)
    if (!pending) throw new Error('import-expired') // jeton inconnu, déjà appliqué ou remplacé par un aperçu plus récent
    pendingImports.delete(token)
    if (pending.kind === 'accounts') {
      const { defaultCurrency } = zoneInfo(pending.zone)
      for (const row of pending.rows) {
        const existing = retailers.find((r) => r.zone === pending.zone && r.name.toLowerCase() === row.name.toLowerCase())
        // La devise du fichier est celle de la page du site ; sans devise, celle proposée par la zone.
        const site = row.website ? [{ currency: row.currency || defaultCurrency, url: row.website }] : []
        if (existing) {
          // Réimporter met à jour sans effacer : les pages déjà saisies sont conservées.
          const updated: Retailer = {
            ...existing,
            segmentation: row.segmentation || existing.segmentation,
            salesReps: row.reps.length ? row.reps : existing.salesReps,
            sites: existing.sites.length === 0 ? site : existing.sites,
          }
          retailers = retailers.map((r) => (r.id === existing.id ? updated : r))
        } else {
          retailers = [
            ...retailers,
            {
              id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: row.name,
              zone: pending.zone,
              tracked: true,
              segmentation: row.segmentation,
              salesReps: row.reps,
              sites: site,
            },
          ]
        }
      }
      return delay(pending.rows.length, 150)
    }
    for (const row of pending.rows) {
      const existing = catalogFor(pending.zone).find((c) => c.sku === row.sku)
      if (existing) {
        existing.model = row.model || existing.model
        existing.material = row.material || existing.material
        existing.color = row.color || existing.color
        existing.season = row.season || existing.season
        existing.dept = row.dept || existing.dept
        existing.variants = [...new Set([...(existing.variants ?? []), ...row.variants])].sort()
        if (row.carryOver !== undefined) existing.carryOver = row.carryOver || undefined
        existing.rrp = { ...existing.rrp, ...row.rrp }
        existing.wholesale = { ...existing.wholesale, ...row.wholesale }
        for (const [k, v] of Object.entries(row.extra) as [keyof typeof row.extra, string][]) if (v) existing[k] = v
        if (row.maxDiscountPct !== undefined) existing.maxDiscountPct = row.maxDiscountPct
      } else {
        const extra = Object.fromEntries(Object.entries(row.extra).filter(([, v]) => v)) as typeof row.extra
        catalogFor(pending.zone).push({
          sku: row.sku,
          model: row.model,
          material: row.material,
          color: row.color,
          dept: row.dept,
          variants: row.variants,
          season: row.season,
          carryOver: row.carryOver || undefined,
          rrp: row.rrp,
          wholesale: row.wholesale,
          maxDiscountPct: row.maxDiscountPct,
          ...extra,
        })
      }
    }
    return delay(pending.rows.length, 150)
  },

  async getRules(zone) {
    const r = rulesFor(zone)
    return delay({ ...r, excludedRetailerIds: [...r.excludedRetailerIds] }, 60)
  },

  async saveRules(zone, rules) {
    rulesByZone.set(zone, { ...rules, excludedRetailerIds: [...rules.excludedRetailerIds] })
    return delay(undefined, 150)
  },

  async previewRules(zone, rules) {
    const list = anomaliesFor(zone, WEEKS.length - 1, rules)
    return delay(
      {
        confirmed: list.filter((a) => a.proof === 'confirmed').length,
        toReview: list.filter((a) => a.proof === 'to-review').length,
        retailers: new Set(list.map((a) => a.retailerId)).size,
      },
      30,
    )
  },

  async getGlobalOverview() {
    const zones: ZoneSummary[] = []
    const bySku = new Map<string, GlobalProductRow>()
    for (const { id: zone } of ZONES) {
      const week = await this.getWeek(zone)
      const scannable = week.retailers.filter((r) => r.status !== 'no-site' && r.status !== 'excluded')
      zones.push({
        zone,
        weekOf: week.weekOf,
        retailers: week.retailers.length,
        scannable: scannable.length,
        inAnomaly: scannable.filter((r) => r.status === 'anomaly').length,
        confirmed: week.confirmed,
        toReview: week.toReview,
        worstDiscountPct: Math.max(0, ...scannable.map((r) => r.worstDiscountPct)),
        currencies: zoneCurrencies(zone),
        products: catalogFor(zone).length,
      })
      for (const p of await this.listProducts(zone)) {
        const row = bySku.get(p.sku) ?? { sku: p.sku, item: p.item, zones: [], accounts: 0, anomalies: 0, worstDiscountPct: 0, worstZone: zone }
        row.zones.push({ zone, accounts: p.accounts, anomalies: p.anomalies, worstDiscountPct: p.worstDiscountPct, currency: p.currency, lowest: p.lowest, rrp: p.rrp })
        row.accounts += p.accounts
        row.anomalies += p.anomalies
        if (p.worstDiscountPct > row.worstDiscountPct) {
          row.worstDiscountPct = p.worstDiscountPct
          row.worstZone = zone
        }
        bySku.set(p.sku, row)
      }
    }
    const products = [...bySku.values()].sort((a, b) => b.anomalies - a.anomalies || b.worstDiscountPct - a.worstDiscountPct || a.item.model.localeCompare(b.item.model, 'fr'))
    return delay({ zones, products }, 80)
  },

  async getGlobalProduct(sku) {
    const out: GlobalProductDetail['zones'] = []
    let item: CatalogItem | undefined
    for (const { id: zone } of ZONES) {
      const d = await this.getProduct(zone, sku)
      if (!d) continue
      item ??= d.item
      out.push({ zone, discountLimitPct: d.discountLimitPct, series: d.series })
    }
    if (!item) return delay(null)
    return delay({ sku, item, zones: out }, 60)
  },

  async listSalePeriods(zone) {
    return delay(salePeriods.filter((p) => p.zone === zone).sort((a, b) => a.start.localeCompare(b.start)))
  },

  async addSalePeriod(p) {
    salePeriods = [...salePeriods, { ...p, id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]
    return delay(undefined, 80)
  },

  async updateSalePeriod(id, p) {
    salePeriods = salePeriods.map((x) => (x.id === id ? { ...x, ...p } : x))
    return delay(undefined, 80)
  },

  async removeSalePeriod(id) {
    salePeriods = salePeriods.filter((p) => p.id !== id)
    return delay(undefined, 60)
  },

  async estimateScans(zone, start, end, plan) {
    const scans = countScanDays(start, end, plan)
    const sites = retailers.filter((r) => r.zone === zone && r.tracked).reduce((n, r) => n + r.sites.length, 0)
    return delay({ scans, sites, visits: scans * sites }, 30)
  },

  async startScan(zone, onProgress) {
    const total = scannable(zone).size
    for (let i = 1; i <= total; i++) {
      await new Promise((r) => setTimeout(r, 260))
      onProgress(i, total)
    }
  },
}

/* ---------------------------------------------------------------------- */
/* Mode serveur : VITE_API_URL (par exemple « /api »). Sans elle, la démonstration locale. */
/* ---------------------------------------------------------------------- */

interface RemoteState {
  zone: Zone
  today: string
  weeks: string[]
  retailers: Retailer[]
  excludedRetailerIds: string[]
  catalog: CatalogItem[]
  periods: SalePeriod[]
  comments: AccountComment[]
  activity: ActivityItem[]
  observations: Observation[]
}

const remoteActivity = new Map<Zone, ActivityItem[]>()

/** Remplace les données d'une zone par celles du serveur ; les écrans se recalculent à partir de là. */
function hydrateZone(s: RemoteState): void {
  const zone = s.zone
  const old = new Set(retailers.filter((r) => r.zone === zone).map((r) => r.id))
  for (const r of s.retailers) old.add(r.id)
  if (s.today > TODAY || remoteActivity.size === 0) TODAY = s.today
  WEEKS.splice(0, WEEKS.length, ...s.weeks)
  retailers = [...retailers.filter((r) => r.zone !== zone), ...s.retailers.map((r) => ({ ...r, zone }))]
  for (let i = OBSERVATIONS.length - 1; i >= 0; i--) if (old.has(OBSERVATIONS[i].retailerId)) OBSERVATIONS.splice(i, 1)
  OBSERVATIONS.push(...s.observations)
  catalogs.set(zone, s.catalog)
  salePeriods = [...salePeriods.filter((p) => p.zone !== zone), ...s.periods]
  comments = [
    ...comments.filter((c) => !old.has(c.retailerId)),
    ...s.comments.map((c) => ({ id: c.id, retailerId: c.retailerId, text: c.text, by: c.by, at: c.at, byId: c.mine ? CURRENT_USER.id : c.by })),
  ]
  rulesByZone.set(zone, { excludedRetailerIds: s.excludedRetailerIds })
  remoteActivity.set(zone, s.activity)
  activity = [...remoteActivity.values()].flat().sort((a, b) => b.at.localeCompare(a.at))
  decisions.clear()
}

function resetDemoData(): void {
  retailers = []
  catalogs.clear()
  OBSERVATIONS.length = 0
  salePeriods = []
  comments = []
  activity = []
  rulesByZone.clear()
  decisions.clear()
}

const API_URL = import.meta.env.VITE_API_URL

/** Mode serveur : relit les quatre zones avant d'afficher l'application. Sans effet en démonstration. */
export async function bootRemote(): Promise<void> {
  if (!API_URL) return
  const request = makeRequest(API_URL)
  resetDemoData()
  const me = await request<SessionUser & { locale: string | null; tourDone: boolean }>('GET', '/me')
  Object.assign(CURRENT_USER, { id: me.id, name: me.name })
  // Langue et tutoriel suivent l'utilisateur, pas le navigateur : un nouvel utilisateur choisit sa langue puis suit le tutoriel,
  // même sur un poste déjà utilisé par quelqu'un d'autre.
  try {
    if (me.locale) localStorage.setItem('pm.lang', me.locale)
    else localStorage.removeItem('pm.lang')
    if (me.tourDone) localStorage.setItem('pm.tourDone', '1')
    else localStorage.removeItem('pm.tourDone')
  } catch {
    /* stockage indisponible */
  }
  await Promise.all(ZONES.map(async (z) => hydrateZone(await request<RemoteState>('GET', `/zones/${z.id}/state`))))
}

function zoneOfRetailer(id: string): Zone | undefined {
  return retailers.find((r) => r.id === id)?.zone
}

export const api: Api = API_URL
  ? createHttpApi(API_URL, mockApi, {
      reload: async (zone) => hydrateZone(await makeRequest(API_URL)<RemoteState>('GET', `/zones/${zone}/state`)),
      zoneOfRetailer,
      zoneOfObservation: (id) => {
        const o = OBSERVATIONS.find((x) => x.id === id)
        return o ? zoneOfRetailer(o.retailerId) : undefined
      },
      zoneOfComment: (id) => {
        const c = comments.find((x) => x.id === id)
        return c ? zoneOfRetailer(c.retailerId) : undefined
      },
      zoneOfPeriod: (id) => salePeriods.find((p) => p.id === id)?.zone,
      takePendingImport: (token) => {
        const p = pendingImports.get(token)
        if (p) pendingImports.delete(token)
        return p
      },
    })
  : mockApi
