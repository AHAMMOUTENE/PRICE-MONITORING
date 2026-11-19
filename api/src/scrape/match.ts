/**
 * Rapprochement d'une fiche revendeur avec le catalogue de la zone. Du plus sûr au moins sûr :
 *  alias appris (décision humaine) → EAN → SKU lisible dans la référence ou l'adresse → titre identique → titre proche.
 * Seuls les trois premiers (et un titre identique et unique) confirment le produit ; le reste est proposé « à vérifier ».
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

const STOP = new Set(['veja', 'the', 'and', 'with', 'for', 'de', 'du', 'la', 'le', 'les', 'et', 'en', 'pour', 'homme', 'femme', 'men', 'women', 'kids', 'mens', 'womens', 'shoes', 'sneakers', 'sneaker', 'trainers', 'baskets', 'chaussures', 'zapatillas', 'tenis'])

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
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

export class CatalogIndex {
  private bySku = new Map<string, CatalogEntry>()
  private byEan = new Map<string, CatalogEntry>()
  private byTitle = new Map<string, CatalogEntry[]>()
  private skus: string[]

  constructor(public entries: CatalogEntry[]) {
    for (const e of entries) {
      this.bySku.set(e.sku, e)
      if (e.ean) this.byEan.set(e.ean, e)
      const key = tokens(`${e.model} ${e.material} ${e.color}`).join(' ')
      if (key) this.byTitle.set(key, [...(this.byTitle.get(key) ?? []), e])
    }
    this.skus = entries.map((e) => e.sku)
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
    const url = canonicalUrl(l.url)
    const title = normalize(l.title)
    // 1. Ce que les utilisateurs ont déjà tranché.
    for (const [kind, value] of [['url', url], ['ean', l.ean ?? ''], ['retailer-ref', normalize(l.ref ?? '')], ['title', title]] as const) {
      if (!value) continue
      const a = aliases?.get(kind, value, siteId)
      if (!a) continue
      if (a.verdict === 'not-veja') return { ...none, skip: true }
      if (a.productId) return { kind: 'alias', proof: 'confirmed', productId: a.productId, confidence: 1 }
    }
    // 2. EAN, 3. SKU dans la référence ou l'adresse.
    if (l.ean && this.byEan.has(l.ean)) return { kind: 'ean', proof: 'confirmed', productId: this.byEan.get(l.ean)!.id, confidence: 1 }
    const bySku = (l.ref && this.skuIn(l.ref)) || this.skuIn(l.url)
    if (bySku) return { kind: 'retailer-ref', proof: 'confirmed', productId: bySku.id, confidence: 0.98 }
    // 4. Titre identique à « modèle matière couleur ».
    const key = tokens(l.title).join(' ')
    const exact = this.byTitle.get(key)
    if (exact?.length === 1) return { kind: 'exact-title', proof: 'confirmed', productId: exact[0].id, confidence: 0.95 }
    // 5. Titre proche : part des mots du produit retrouvés dans le titre, pénalisée par les mots en trop.
    const tt = new Set(tokens(l.title))
    let best: { e: CatalogEntry; score: number } | undefined
    let second = 0
    for (const e of this.entries) {
      const pt = tokens(`${e.model} ${e.material} ${e.color}`)
      if (!pt.length) continue
      const hit = pt.filter((t) => tt.has(t)).length
      const score = (hit / pt.length) * (hit / Math.max(tt.size, pt.length)) ** 0.5
      if (!best || score > best.score) {
        second = best?.score ?? 0
        best = { e, score }
      } else if (score > second) second = score
    }
    if (best && best.score >= 0.5) {
      const confidence = Math.round(Math.min(0.94, best.score - (second > best.score - 0.05 ? 0.1 : 0)) * 100) / 100
      return { kind: 'fuzzy', proof: 'to-review', candidateId: best.e.id, confidence }
    }
    return none
  }
}

/** Une fiche sans lien avec le catalogue n'est conservée que si elle se présente comme du VEJA. */
export function looksLikeVeja(l: RawListing): boolean {
  return /veja/i.test(`${l.brand ?? ''} ${l.title} ${l.url}`)
}
