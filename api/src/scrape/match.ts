/**
 * Rapprochement d'une fiche revendeur avec le catalogue de la zone. Du plus sûr au moins sûr :
 *  alias appris (décision humaine) → EAN → SKU lisible dans la référence ou l'adresse → modèle ET couleur retrouvés → titre proche.
 * Sont confirmés : les trois premiers, et « modèle et couleur retrouvés en entier, sans ambiguïté ».
 * Le reste est proposé « à vérifier », avec le produit le plus probable.
 */
import type { RawListing } from './extract.ts'

export interface CatalogEntry {
  id: string
  sku: string
  model: string
  material: string
  color: string
  ean?: string
}
export type MatchKind = 'alias' | 'ean' | 'retailer-ref' | 'exact-title' | 'fuzzy' | 'none'
export interface MatchResult {
  kind: MatchKind
  proof: 'confirmed' | 'to-review'
  productId?: string
  candidateId?: string
  confidence: number
  /** Fiche d'une autre marque ou refusée par un utilisateur : à ne pas conserver. */
  skip?: boolean
}
export interface AliasIndex {
  /** clé « kind|valeur » (par page) ou « kind|valeur » (toute la zone) → verdict */
  get(kind: 'url' | 'title' | 'retailer-ref' | 'ean', value: string, siteId: string): { verdict: 'product' | 'not-veja'; productId?: string } | undefined
}

const STOP = new Set(['veja', 'the', 'and', 'with', 'for', 'de', 'du', 'la', 'le', 'les', 'et', 'en', 'pour', 'homme', 'femme', 'men', 'women', 'kids', 'mens', 'womens', 'shoes', 'sneakers', 'sneaker', 'trainers', 'baskets', 'chaussures', 'zapatillas', 'tenis', 'unisex'])

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(?<=\b[a-z])\.(?=[a-z]\b)/g, '') // « o.t. » → « ot »
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
export const tokens = (s: string): string[] => normalize(s).split(' ').filter((t) => t && !STOP.has(t))

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url)
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

/** Mots de l'adresse d'une fiche : « …/veja-volley-ot-leather-silver-white-natural » donne souvent le modèle et la couleur. */
export function slugText(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return (parts[parts.length - 1] ?? '').replace(/\.(html?|php)$/i, '').replace(/[-_]+/g, ' ')
  } catch {
    return ''
  }
}

/** Nom du fichier de l'image d'une fiche : les revendeurs y laissent souvent la référence VEJA (« CP0502429A_1.jpg ») ou la couleur. */
export function imageName(url: string | undefined): string {
  if (!url) return ''
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return decodeURIComponent(last).replace(/\.(jpe?g|png|webp|avif|gif)$/i, '').replace(/[-_.]+/g, ' ')
  } catch {
    return ''
  }
}

/**
 * Identité d'une fiche chez un revendeur : l'adresse, plus la couleur quand une même page en présente plusieurs
 * (chaque couleur est alors un produit à part).
 */
export function listingKey(l: Pick<RawListing, 'url' | 'color'>): string {
  let hash = ''
  try {
    hash = new URL(l.url).hash
  } catch {
    /* adresse invalide : on garde l'adresse telle quelle */
  }
  const color = l.color ? '#' + normalize(l.color).replace(/ /g, '-') : ''
  return canonicalUrl(l.url) + hash + color
}

interface Prepared {
  e: CatalogEntry
  model: string[]
  color: string[]
  material: string[]
  all: string
}

const coverage = (needed: string[], have: Set<string>): number => (needed.length ? needed.filter((t) => have.has(t)).length / needed.length : 1)

export class CatalogIndex {
  private bySku = new Map<string, CatalogEntry>()
  private byEan = new Map<string, CatalogEntry>()
  private prepared: Prepared[]
  private skus: string[]

  constructor(public entries: CatalogEntry[]) {
    for (const e of entries) {
      this.bySku.set(e.sku, e)
      if (e.ean) this.byEan.set(e.ean, e)
    }
    this.skus = entries.map((e) => e.sku)
    this.prepared = entries.map((e) => {
      const model = tokens(e.model)
      const color = tokens(e.color)
      const material = tokens(e.material)
      return { e, model, color, material, all: [...model, ...material, ...color].join(' ') }
    })
  }

  /** SKU du catalogue lisible dans un texte : les 9 premiers caractères d'une référence plus longue comptent aussi. */
  skuIn(text: string): CatalogEntry | undefined {
    const up = text.toUpperCase().replace(/[^A-Z0-9]/g, ' ')
    for (const word of up.split(/\s+/)) {
      if (word.length < 9) continue
      const hit = this.bySku.get(word.slice(0, 9))
      if (hit) return hit
    }
    // Référence collée dans une adresse (« …-ca0306a »).
    const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return this.skus.length > 0 ? this.entries.find((e) => compact.includes(e.sku)) : undefined
  }

  match(l: RawListing, siteId: string, aliases?: AliasIndex): MatchResult {
    const none: MatchResult = { kind: 'none', proof: 'to-review', confidence: 0 }
    const key = listingKey(l)
    const title = normalize(l.title)
    // 1. Ce que les utilisateurs ont déjà tranché.
    for (const [kind, value] of [['url', key], ['ean', l.ean ?? ''], ['retailer-ref', normalize(l.ref ?? '')], ['title', title]] as const) {
      if (!value) continue
      const a = aliases?.get(kind, value, siteId)
      if (!a) continue
      if (a.verdict === 'not-veja') return { ...none, skip: true }
      if (a.productId) return { kind: 'alias', proof: 'confirmed', productId: a.productId, confidence: 1 }
    }
    // 2. EAN, 3. SKU dans la référence ou l'adresse.
    if (l.ean && this.byEan.has(l.ean)) return { kind: 'ean', proof: 'confirmed', productId: this.byEan.get(l.ean)!.id, confidence: 1 }
    // Tout ce que la page liste dit du produit : sa référence, l'adresse de sa fiche, le nom du fichier de son image.
    const bySku = (l.ref && this.skuIn(l.ref)) || this.skuIn(l.url) || this.skuIn(imageName(l.image))
    if (bySku) return { kind: 'retailer-ref', proof: 'confirmed', productId: bySku.id, confidence: 0.98 }

    // 4-5. Modèle et couleur : titre, couleur annoncée et mots de l'adresse, tous ensemble.
    const have = new Set(tokens([l.title, l.color ?? '', slugText(l.url), imageName(l.image)].join(' ')))
    if (have.size === 0) return none
    const scored = this.prepared
      .map((p) => {
        const model = coverage(p.model, have)
        const color = coverage(p.color, have)
        const material = coverage(p.material, have)
        // Le modèle compte pour beaucoup : sans lui, la couleur seule ne dit rien.
        const score = (0.4 * model + 0.45 * color + 0.15 * material) * (model < 1 ? 0.6 : 1)
        return { p, model, color, score }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
    const best = scored[0]
    if (!best) return none
    const margin = best.score - (scored[1]?.score ?? 0)
    // Modèle ET couleur retrouvés en entier, et un seul produit se détache : l'identification est sûre.
    if (best.model === 1 && best.color === 1 && best.p.color.length > 0 && best.p.model.length > 0 && margin >= 0.1) {
      return { kind: 'exact-title', proof: 'confirmed', productId: best.p.e.id, confidence: 0.93 }
    }
    if (best.score >= 0.5) {
      const confidence = Math.round(Math.min(0.9, best.score - (margin < 0.05 ? 0.1 : 0)) * 100) / 100
      return { kind: 'fuzzy', proof: 'to-review', candidateId: best.p.e.id, confidence }
    }
    return none
  }
}

/** Une fiche sans lien avec le catalogue n'est conservée que si elle se présente comme du VEJA. */
export function looksLikeVeja(l: RawListing): boolean {
  return /veja/i.test(`${l.brand ?? ''} ${l.title} ${l.url}`)
}
