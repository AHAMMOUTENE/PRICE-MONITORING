/**
 * Lecture d'une page revendeur : les produits avec prix. Trois stratégies, de la moins chère à la plus chère :
 *  1. données structurées (JSON-LD schema.org) : gratuit, fiable, la plupart des boutiques ;
 *  2. Shopify (products.json) : prix, prix barré, SKU et EAN directement ;
 *  3. lecture par Claude du HTML nettoyé, uniquement si les deux premières ne trouvent rien.
 */
export interface RawListing {
  title: string
  url: string
  price: number
  originalPrice?: number
  currency?: string
  image?: string
  /** Référence affichée par le revendeur (SKU, MPN). */
  ref?: string
  ean?: string
  inStock?: boolean
  brand?: string
}

/** « 1.299,90 », « 129,95 », « 129.95 », 129.95 → nombre. */
export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/[^\d.,]/g, '')
  if (!s) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let norm = s
  if (lastComma > -1 && lastDot > -1) norm = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (lastComma > -1) norm = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  const n = Number(norm)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined)

function absolute(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    return new URL(href, base).toString()
  } catch {
    return undefined
  }
}

function typeOf(node: any): string[] {
  return asArray<string>(node?.['@type']).map(String)
}

function imageOf(v: any, base: string): string | undefined {
  const first = asArray<any>(v)[0]
  return absolute(typeof first === 'string' ? first : str(first?.url), base)
}

/** Prix courant et prix barré d'une offre (Offer, AggregateOffer, liste d'offres). */
function pricesOf(offers: any): { price?: number; original?: number; currency?: string; inStock?: boolean } {
  let price: number | undefined
  let original: number | undefined
  let currency: string | undefined
  let inStock: boolean | undefined
  for (const o of asArray<any>(offers)) {
    const spec = asArray<any>(o?.priceSpecification)
    const p = parsePrice(o?.price) ?? parsePrice(o?.lowPrice) ?? parsePrice(spec.find((s) => !/list|strike|original/i.test(String(s?.priceType ?? '')))?.price)
    if (p !== null && p !== undefined && (price === undefined || p < price)) price = p
    const struck = spec.find((s) => /list|strike|original|msrp/i.test(String(s?.priceType ?? '')))
    const so = parsePrice(struck?.price) ?? parsePrice(o?.highPrice)
    if (so !== null && so !== undefined && (original === undefined || so > original)) original = so
    currency ??= str(o?.priceCurrency) ?? str(spec[0]?.priceCurrency)
    if (o?.availability) inStock = inStock || /InStock|LimitedAvailability|PreOrder/i.test(String(o.availability))
  }
  if (original !== undefined && price !== undefined && original <= price) original = undefined
  return { price, original, currency: currency?.toUpperCase(), inStock }
}

function fromProductNode(n: any, base: string): RawListing | null {
  const variants = asArray<any>(n.hasVariant)
  const own = pricesOf(n.offers)
  let { price, original, currency, inStock } = own
  if (price === undefined && variants.length) {
    // ProductGroup : le prix affiché est celui de la variante la moins chère.
    for (const v of variants) {
      const vp = pricesOf(v.offers)
      if (vp.price !== undefined && (price === undefined || vp.price < price)) ({ price, original, currency, inStock } = vp)
    }
  }
  const title = str(n.name)
  const url = absolute(str(n.url) ?? str(n['@id']), base) ?? base
  if (!title || price === undefined) return null
  const brand = typeof n.brand === 'string' ? n.brand : str(n.brand?.name)
  const ean = [n.gtin13, n.gtin, n.gtin14, n.gtin12, n.gtin8].map(str).find((g) => g && /^\d{8,14}$/.test(g))
  return { title, url, price, originalPrice: original, currency, image: imageOf(n.image, base), ref: str(n.sku) ?? str(n.mpn) ?? str(n.productID), ean, inStock, brand }
}

/** Parcourt un nœud JSON-LD (tableau, @graph, ItemList…) et collecte les produits avec prix. */
function walk(node: any, base: string, out: RawListing[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 8) return
  if (Array.isArray(node)) return node.forEach((n) => walk(n, base, out, depth + 1))
  const types = typeOf(node)
  if (types.includes('Product') || types.includes('ProductGroup')) {
    const l = fromProductNode(node, base)
    if (l) out.push(l)
    return
  }
  if (types.includes('ListItem') && node.item) return walk(node.item, base, out, depth + 1)
  for (const k of ['@graph', 'itemListElement', 'mainEntity', 'item']) if (node[k]) walk(node[k], base, out, depth + 1)
}

export function extractJsonLd(html: string, pageUrl: string): RawListing[] {
  const out: RawListing[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(re)) {
    try {
      walk(JSON.parse(m[1].trim().replace(/^<!--|-->$/g, '')), pageUrl, out)
    } catch {
      /* bloc JSON-LD invalide : ignoré */
    }
  }
  return dedupe(out)
}

function dedupe(list: RawListing[]): RawListing[] {
  const seen = new Set<string>()
  return list.filter((l) => {
    const k = l.url.split('#')[0] + '|' + (l.ref ?? '') + '|' + l.title
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Réponse de `/products.json` d'une boutique Shopify. */
export function extractShopify(json: string, origin: string): RawListing[] {
  let data: any
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  const out: RawListing[] = []
  for (const p of asArray<any>(data?.products)) {
    const variants = asArray<any>(p.variants).filter((v) => parsePrice(v.price) !== null)
    if (!variants.length) continue
    const cheapest = variants.reduce((a, b) => (parsePrice(b.price)! < parsePrice(a.price)! ? b : a))
    const price = parsePrice(cheapest.price)!
    const compare = parsePrice(cheapest.compare_at_price)
    const barcode = variants.map((v) => str(v.barcode)).find((b) => b && /^\d{8,14}$/.test(b))
    out.push({
      title: String(p.title ?? ''),
      url: `${origin}/products/${p.handle}`,
      price,
      originalPrice: compare !== null && compare > price ? compare : undefined,
      image: str(p.images?.[0]?.src),
      ref: str(cheapest.sku),
      ean: barcode,
      inStock: variants.some((v) => v.available !== false),
      brand: str(p.vendor),
    })
  }
  return out
}

/** Adresse de la page suivante d'une liste (lien rel="next"), le cas échéant. */
export function nextPageUrl(html: string, pageUrl: string): string | undefined {
  const link = html.match(/<link[^>]+rel=["']next["'][^>]*>/i)?.[0] ?? html.match(/<a[^>]+rel=["']next["'][^>]*>/i)?.[0]
  const href = link?.match(/href=["']([^"']+)["']/i)?.[1]
  return absolute(href?.replace(/&amp;/g, '&'), pageUrl)
}

/** HTML réduit à l'essentiel pour la lecture par Claude : sans scripts, styles, svg ni attributs inutiles. */
export function cleanHtml(html: string, maxChars = 60_000): string {
  const s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|noscript|iframe|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(\w+)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g, (_m, tag: string, attrs: string) => {
      const keep = [...attrs.matchAll(/\s(href|src|alt|data-price|data-sku)=("[^"]*"|'[^']*')/gi)].map((a) => `${a[1]}=${a[2]}`).join(' ')
      return keep ? `<${tag} ${keep}>` : `<${tag}>`
    })
    .replace(/\s+/g, ' ')
  return s.length > maxChars ? s.slice(0, maxChars) : s
}

export interface LlmExtractor {
  extract(html: string, pageUrl: string): Promise<{ listings: RawListing[]; costUsd: number }>
}

/** Lecture par Claude (API Messages, sortie structurée par outil). Coût estimé d'après les jetons. */
export class ClaudeExtractor implements LlmExtractor {
  constructor(
    private apiKey: string,
    private model = 'claude-haiku-5-5',
    private priceInPerM = 1,
    private priceOutPerM = 5,
  ) {}

  async extract(html: string, pageUrl: string) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8000,
        tools: [
          {
            name: 'report_products',
            description: 'Liste des produits VEJA affichés sur la page, avec leur prix courant.',
            input_schema: {
              type: 'object',
              properties: {
                products: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      url: { type: 'string', description: 'Lien de la fiche produit, tel qu’écrit dans la page' },
                      price: { type: 'number', description: 'Prix actuellement affiché, nombre sans symbole' },
                      originalPrice: { type: 'number', description: 'Prix barré, seulement s’il y en a un' },
                      image: { type: 'string' },
                      ref: { type: 'string', description: 'Référence ou SKU affiché, s’il y en a une' },
                    },
                    required: ['title', 'price'],
                  },
                },
              },
              required: ['products'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'report_products' },
        messages: [{ role: 'user', content: `Page : ${pageUrl}\nListe les produits de la marque VEJA (chaussures, sacs, accessoires) avec leur prix affiché. Ignore les autres marques.\n\n${cleanHtml(html)}` }],
      }),
    })
    if (!res.ok) throw new Error(`Claude ${res.status}`)
    const data: any = await res.json()
    const input = data.content?.find((c: any) => c.type === 'tool_use')?.input
    const listings: RawListing[] = []
    for (const p of asArray<any>(input?.products)) {
      const price = parsePrice(p.price)
      if (!p.title || price === null) continue
      const original = parsePrice(p.originalPrice)
      listings.push({ title: String(p.title), url: absolute(str(p.url), pageUrl) ?? pageUrl, price, originalPrice: original !== null && original > price ? original : undefined, image: absolute(str(p.image), pageUrl), ref: str(p.ref) })
    }
    const costUsd = ((data.usage?.input_tokens ?? 0) * this.priceInPerM + (data.usage?.output_tokens ?? 0) * this.priceOutPerM) / 1_000_000
    return { listings, costUsd }
  }
}

export function extractorFromEnv(env: Record<string, string | undefined>): LlmExtractor | null {
  return env.ANTHROPIC_API_KEY ? new ClaudeExtractor(env.ANTHROPIC_API_KEY, env.EXTRACT_MODEL || undefined) : null
}
