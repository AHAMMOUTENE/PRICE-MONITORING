/** Code ISO 4217 (EUR, GBP, USD…). Chaque site revendeur a sa devise ; n'importe quelle devise est acceptée. */
export type Currency = string
/** Zones commerciales : voir lib/zones.ts. */
export type Zone = 'EMEA' | 'LATAM' | 'APAC' | 'NOAM'

/** Confirmée = SKU validé. À valider = produit proposé par le rapprochement, un humain tranche. */
export type Proof = 'confirmed' | 'to-review'

export type Reason = 'non-discounted-model' | 'over-max-discount'

/** Une page VEJA chez un revendeur : ses prix sont comparés au RRP de cette devise. */
export interface SiteVersion {
  currency: Currency
  url: string
}

export interface Retailer {
  id: string
  name: string
  zone: Zone
  /** Coché dans la liste des comptes : le compte est scanné et apparaît dans le suivi. */
  tracked: boolean
  segmentation: string
  salesReps: string[]
  sites: SiteVersion[]
}

export interface CatalogItem {
  /** Les 9 premiers caractères de la référence VEJA : l'identifiant du produit. */
  sku: string
  /** Lettres qui suivent le SKU dans les références (A, B, C, D : femme, homme, enfant…), sans effet sur l'identité. */
  variants?: string[]
  model: string
  material: string
  color: string
  dept: string
  /** Saison du produit : « AW26 », « SS27 »… */
  season: string
  /** Carry-over : le produit continue la saison suivante. La liste carry-over de VEJA est la liste des produits à ne pas solder. */
  carryOver?: boolean
  rrp: Partial<Record<Currency, number>>
  /** Prix de gros (UNIT PRICE / WHS) par devise, quand le catalogue le fournit. */
  wholesale: Partial<Record<Currency, number>>
  /** Règle de remise du produit, en %. 0 : produit non soldé. Absente : le produit n'est pas contrôlé. */
  maxDiscountPct?: number
  /** Autres colonnes du fichier VEJA, gardées telles quelles. */
  segmentation?: string
  colorCode?: string
  description?: string
  composition?: string
  origin?: string
  ean?: string
}

export interface PricePoint {
  /** Lundi du relevé, au format ISO. */
  week: string
  price: number
}

/** Un produit vu sur un site revendeur, avec son historique de prix. */
export interface Observation {
  id: string
  retailerId: string
  title: string
  url: string
  currency: Currency
  model: string
  color: string
  sku?: string
  /** Image du produit chez le revendeur, quand le scan la récupère. */
  image?: string
  rrp: number
  originalPrice?: number
  history: PricePoint[]
  proof: Proof
  candidate?: { sku: string; confidence: number }
}

export interface Rules {
  /** Comptes dont les remises ne sont jamais signalées (outlet, boutique officielle…). */
  excludedRetailerIds: string[]
}

export interface Anomaly extends Observation {
  retailerName: string
  salePrice: number
  discountPct: number
  reason: Reason
  /** Règle du produit au moment de l'évaluation (toujours présente pour une anomalie). */
  discountLimitPct: number
  /** Relevés hebdomadaires consécutifs en anomalie, celui-ci compris. */
  consecutiveChecks: number
  firstSeen: string
  lastSeen: string
  segmentation: string
  salesReps: string[]
  /** Produit VEJA proposé quand le SKU n'est pas sûr. */
  proposal?: { item: CatalogItem; confidence: number }
}

export type RetailerStatus = 'anomaly' | 'ok' | 'no-site' | 'excluded'

export interface RetailerWeekRow {
  retailer: Retailer
  status: RetailerStatus
  scanned: number
  confirmed: number
  toReview: number
  worstDiscountPct: number
  /** Jusqu'à trois produits en anomalie, pour l'aperçu en liste. */
  previews: { sku?: string; color: string; title: string; image?: string }[]
  /** Produits confirmés en anomalie sur chacune des semaines, de la plus ancienne à la plus récente. */
  trend: number[]
  /** Commentaires laissés par l'équipe sur ce compte, et le plus récent. */
  comments: number
  lastComment?: AccountComment
}

export interface WeekOverview {
  weekOf: string
  /** Toutes les semaines disponibles, la plus récente en premier. */
  weeks: string[]
  /** Anomalies confirmées par semaine, pour le sélecteur. */
  weekStats: { week: string; confirmed: number }[]
  isCurrent: boolean
  confirmed: number
  toReview: number
  retailersInAnomaly: number
  deltaConfirmed: number | null
  nextScan: string
  currentSale: SalePeriod | null
  retailers: RetailerWeekRow[]
}

export type ReviewDecision =
  | { kind: 'accepted' }
  | { kind: 'corrected'; sku: string }
  | { kind: 'no-match' }

/**
 * Rythme des scans pendant une période de soldes. Hors période, un scan a lieu chaque lundi.
 * `weekly` : certains jours de la semaine (1 = lundi … 7 = dimanche). `daily` : tous les jours, coûteux.
 */
export type ScanPlan = { mode: 'weekly'; days: number[] } | { mode: 'daily' }

export interface SalePeriod {
  id: string
  zone: Zone
  label: string
  start: string
  end: string
  scan: ScanPlan
}

/** Ce qu'un plan de scan représente sur une période : nombre de scans et de visites de sites. */
export interface ScanEstimate {
  scans: number
  sites: number
  visits: number
}

export interface ExportFilters {
  fromWeek: string
  toWeek: string
  retailerIds: string[]
  proof: 'all' | Proof
  productIds?: string[]
}

/** Une ligne du fichier « FOLLOW UP IMAGE ONLINE » : une ligne par revendeur. */
export interface FollowUpRow {
  name: string
  website: string
  segmentation: string
  salesReps: string
  onAnomaly: boolean
  skuCount: number
  /** Fraction entre 0 et 1, ou null si aucune remise. */
  avgDiscount: number | null
  comments: string
}

export interface ExportData {
  season: string
  zone: Zone
  weekOf: string
  summary: FollowUpRow[]
  detailHeader: string[]
  detailRows: (string | number | null)[][]
  fileName: string
}

export type CsvDelimiter = ';' | ',' | '\t'

export interface ImportOptions {
  /** Séparateur à utiliser pour un CSV ; sinon il est détecté. */
  delimiter?: CsvDelimiter
  /** Onglet du classeur à lire ; sinon le premier. */
  sheet?: string
  /** Catalogue : saison attribuée aux produits ; sinon elle est lue dans le nom de l'onglet ou du fichier. */
  season?: string
  /** Catalogue : le fichier entier est la liste des produits à ne pas solder (tous passent en remise autorisée 0). */
  noDiscount?: boolean
  /** Correspondance choisie par l'utilisateur : donnée attendue → index de colonne du fichier (-1 : aucune). */
  mapping?: Record<string, number>
}

export interface ImportPreview {
  /** Jeton à passer à `commitImport` pour appliquer ce fichier. */
  token: string
  /** Séparateur utilisé si le fichier est un CSV ; l'utilisateur peut le changer. */
  delimiter?: CsvDelimiter
  /** Onglets du classeur et celui qui est lu, quand il y en a plusieurs. */
  sheets?: string[]
  sheet?: string
  /** Catalogue : saison attribuée aux produits importés. */
  season?: string
  /** Catalogue : vrai si tous les produits du fichier passent en « non soldé » (proposé pour une « CARRY OVER LIST »). */
  noDiscount?: boolean
  /** Lignes ignorées (ni site, ni segmentation, ni sales rep : totaux, lignes vides). */
  skipped?: number
  /** Colonnes du fichier, et pour chaque donnée attendue l'index de colonne retenu (-1 : aucune). */
  fileColumns?: string[]
  mapping?: Record<string, number>
  fileName: string
  rows: number
  /** Colonnes du fichier reconnues, avec leur nom d'origine. */
  /** `label` remplace la traduction de `key` quand la colonne dépend des données (ex. « RRP GBP »). */
  recognized: { key: string; from: string; label?: string }[]
  warnings: { kind: 'noSite' | 'noPrice' | 'missingColumn' | 'empty' | 'unsupported' | 'xlsOld' | 'badPrice'; n: number; currency?: string; column?: string }[]
  /** Le fichier peut être importé (colonnes obligatoires présentes, au moins une ligne). */
  canImport: boolean
  /** Toutes les lignes lues, telles qu'elles seront importées. */
  sample: string[][]
  /** Clés de colonnes (traduites par l'interface). */
  header: string[]
}

/**
 * Une ligne de la liste des produits : un SKU vu chez un ou plusieurs comptes.
 * `lowest`, `rrp` et `currency` décrivent le pire cas : le compte le plus remisé, dans la devise de son site.
 */
export interface ProductRow {
  sku: string
  item: CatalogItem
  currency: Currency
  rrp: number
  accounts: number
  lowest: number
  worstDiscountPct: number
  anomalies: number
  toReview: number
}

export interface ProductSeries {
  retailerId: string
  retailerName: string
  /** Devise du site observé, et RRP du produit dans cette devise. */
  currency: Currency
  rrp: number
  points: PricePoint[]
  currentPrice: number
  discountPct: number
  /** Variation du prix depuis la semaine précédente (négatif = baisse). */
  change: number
  anomaly: boolean
  proof: Proof
  url: string
}

export interface ProductDetail {
  item: CatalogItem
  /** Règle du produit ; absente si le produit n'est pas contrôlé. */
  discountLimitPct?: number
  /** Devises des sites où le produit est vendu, la plus fréquente d'abord. */
  currencies: Currency[]
  weeks: string[]
  series: ProductSeries[]
}

/* ───────── Vue globale (toutes zones, lecture seule) ───────── */

export interface ZoneSummary {
  zone: Zone
  weekOf: string
  retailers: number
  /** Comptes avec au moins une page suivie et non exclus. */
  scannable: number
  inAnomaly: number
  confirmed: number
  toReview: number
  worstDiscountPct: number
  currencies: Currency[]
  products: number
}

/** Un produit (SKU) vu à travers les zones. */
export interface GlobalProductRow {
  sku: string
  item: CatalogItem
  zones: { zone: Zone; accounts: number; anomalies: number; worstDiscountPct: number; currency: Currency; lowest: number; rrp: number }[]
  accounts: number
  anomalies: number
  worstDiscountPct: number
  worstZone: Zone
}

export interface GlobalOverview {
  zones: ZoneSummary[]
  products: GlobalProductRow[]
}

export interface GlobalProductDetail {
  sku: string
  item: CatalogItem
  zones: { zone: Zone; discountLimitPct?: number; series: ProductSeries[] }[]
}

export interface WeekReport {
  weekOf: string
  confirmed: number
  toReview: number
  accountsInAnomaly: number
}

export interface ActivityItem {
  id: string
  at: string
  kind: 'accepted' | 'corrected' | 'no-match' | 'commented'
  title: string
  retailerName: string
  /** Utilisateur qui a fait l'action. */
  by?: string
  /** Texte du commentaire, pour les actions « commenté ». */
  note?: string
}

/** L'utilisateur connecté (identité fournie par le SSO). */
export interface SessionUser {
  id: string
  name: string
}

/**
 * Un commentaire libre laissé par un utilisateur sur un compte (« appelé le 12, promet de corriger »).
 * L'application n'envoie rien et ne déduit aucun état : c'est un carnet partagé par l'équipe.
 */
export interface AccountComment {
  id: string
  retailerId: string
  text: string
  by: string
  /** Date et heure, ISO 8601. */
  at: string
  /** Vrai si l'utilisateur connecté en est l'auteur (il peut alors le supprimer). */
  mine: boolean
}

export type AlertKind = 'to-review' | 'recurrence' | 'site-missing'

export interface Alert {
  id: string
  kind: AlertKind
  retailerId: string
  retailerName: string
  /** Produits concernés (en anomalie, ou à identifier selon le type d'alerte). */
  products: number
  /** Semaines consécutives en anomalie. */
  weeks: number
  /** Semaines sans anomalie avant le retour (récidive). */
  gapWeeks?: number
}

/** Un produit suivi chez un compte, qu'il soit en anomalie ou non. */
export interface AccountProduct extends Observation {
  salePrice: number
  discountPct: number
  /** Motif d'anomalie, ou null si le produit est conforme. */
  reason: Reason | null
  /** Règle du produit ; absente si le produit n'est pas contrôlé. */
  discountLimitPct?: number
  /** Variation du prix depuis la semaine précédente (négatif = baisse). */
  change: number
  consecutiveChecks: number
  firstSeen?: string
  proposal?: { item: CatalogItem; confidence: number }
}
