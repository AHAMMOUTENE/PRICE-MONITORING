/**
 * Données de démonstration.
 * Les noms de produits et de revendeurs reprennent ceux du POC ; les prix, les
 * SKUs et les revendeurs en .example sont fictifs. À remplacer par l'API réelle.
 */
import type { CatalogItem, Observation, Retailer, SalePeriod, Rules } from '../types'

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Eight weekly checks, the last one being the current Monday. */
export const WEEKS: string[] = Array.from({ length: 8 }, (_, i) => addDays('2026-09-28', i * 7))
/** Saison suivie. */
export const SEASON = 'AW26'

export const CURRENT_WEEK = WEEKS[WEEKS.length - 1]
export const NEXT_SCAN = addDays(CURRENT_WEEK, 7)

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Prix GBP et USD de démonstration, dérivés du prix en euros (arrondis à 5, comme la grille VEJA). */
const toGbp = (eur: number) => Math.round((eur * 0.89) / 5) * 5
const toUsd = (eur: number) => Math.round((eur * 1.18) / 5) * 5
const r5 = (n: number) => Math.round(n / 5) * 5
const half = (n: number) => Math.round(n * 2) / 2

/** Saison de démonstration par modèle (la saison en cours, sauf quelques modèles de la suivante). */
const SEASON_BY_MODEL: Record<string, string> = { 'Rio Branco': 'SS27', Panenka: 'SS27' }
/** Carry-over : la liste des produits que VEJA ne veut pas voir soldés. */
const CARRY_OVER = new Set(['Campo', 'V-10', 'Esplar'])
/** Règle de remise par modèle : 0 = non soldé (les carry-over), sinon la remise autorisée ; sans règle, le produit n'est pas contrôlé. */
const MAX_DISCOUNT_BY_MODEL: Record<string, number> = { Campo: 0, 'V-10': 0, Esplar: 0, Etna: 30, Montana: 20, Arpoador: 25, GT: 20, 'Rio Branco': 30, Panenka: 20, Cateyes: 20, Recife: 20, ARMD: 30 }

/** Catalogue réel : modèle, matière, couleur, SKU, prix de référence par devise et prix de gros en euros. */
const c = (ref: string, model: string, material: string, color: string, rrpEur: number, wholesaleEur: number): CatalogItem => ({
  sku: ref.slice(0, 9), // la lettre finale (A = adulte) est une variante, pas l'identité
  variants: [ref.slice(9)],
  model,
  material,
  color,
  dept: '',
  season: SEASON_BY_MODEL[model] ?? 'AW26',
  carryOver: CARRY_OVER.has(model) || undefined,
  rrp: { EUR: rrpEur, GBP: toGbp(rrpEur), USD: toUsd(rrpEur), BRL: r5(rrpEur * 5.3), AUD: r5(rrpEur * 1.78), CAD: r5(rrpEur * 1.63), KRW: Math.round((rrpEur * 1700) / 10000) * 10000, MXN: Math.round((rrpEur * 29) / 100) * 100 },
  wholesale: { EUR: wholesaleEur, GBP: half(wholesaleEur * 0.86), USD: half(wholesaleEur * 1.37), BRL: half(wholesaleEur * 5.54), AUD: half(wholesaleEur * 1.85), CAD: half(wholesaleEur * 1.77), KRW: Math.round(wholesaleEur * 1770 / 100) * 100, MXN: Math.round(wholesaleEur * 27.8 / 10) * 10 },
  maxDiscountPct: MAX_DISCOUNT_BY_MODEL[model],
})

export const CATALOG: CatalogItem[] = [
  c('EE4323079A', 'Montana', 'Rope', 'Black', 75, 31.5),
  c('EE4323083A', 'Montana', 'Rope', 'Marsala amarante', 75, 31.5),
  c('EE4323080A', 'Montana', 'Rope', 'Olympe', 75, 31.5),
  c('EE4323082A', 'Montana', 'Rope', 'Pierre black', 75, 31.5),
  c('EE4323081A', 'Montana', 'Rope', 'Tent', 75, 31.5),
  c('EY2022382A', 'ARMD', 'O.T. Leather', 'White natural', 135, 56.5),
  c('EY2022732A', 'ARMD', 'O.T. Leather', 'Pure calcaire', 135, 56.5),
  c('AP3221036A', 'Arpoador', 'Suede Soft', 'Full-black', 130, 54.5),
  c('AP3221980A', 'Arpoador', 'Suede Soft', 'Taupe falcon', 130, 54.5),
  c('CP0503121A', 'Campo', 'Leather (05)', 'Extra-white california', 140, 58.5),
  c('CP0501215A', 'Campo', 'Leather (05)', 'Black white', 140, 58.5),
  c('CP0501537A', 'Campo', 'Leather (05)', 'Extra-white black', 140, 58.5),
  c('CP0503495A', 'Campo', 'Leather (05)', 'Extra-white platine', 140, 58.5),
  c('CP0522144A', 'Campo', 'Leather (05)', 'White grenat', 140, 58.5),
  c('CP0502429A', 'Campo', 'Leather (05)', 'Extra-white natural-suede', 140, 58.5),
  c('CP0502347A', 'Campo', 'Leather (05)', 'Extra-white kaki', 140, 58.5),
  c('CP0322470A', 'Campo', 'Suede', 'Shadow cashew', 140, 58.5),
  c('CP0321435A', 'Campo', 'Suede', 'Taupe pierre natural', 140, 58.5),
  c('EQ0221906A', 'Cateyes', 'Leather', 'Silver white', 150, 62.5),
  c('EQ0321900A', 'Cateyes', 'Suede', 'Eagle cashew', 150, 62.5),
  c('EA0200001A', 'Esplar', 'Leather', 'Extra-white', 130, 54.5),
  c('EO0200005A', 'Esplar', 'Leather', 'Extra-white black', 130, 54.5),
  c('EO0202335A', 'Esplar', 'Leather', 'Extra-white sable', 130, 54.5),
  c('SA3222525A', 'Etna', 'Suede Soft', 'Dried-petale', 120, 50),
  c('SA3220670A', 'Etna', 'Suede Soft', 'Taupe almond', 120, 50),
  c('SA3220678A', 'Etna', 'Suede Soft', 'Brown brown black', 120, 50),
  c('AI0122519A', 'GT', 'Canvas', 'Walnut cashew', 130, 54.5),
  c('AI0222733A', 'GT', 'Leather', 'Pure platine', 135, 56.5),
  c('AI0221652A', 'GT', 'Leather', 'White natural', 135, 56.5),
  c('AI0321656A', 'GT', 'Suede', 'Taupe pierre', 135, 56.5),
  c('FU2020707A', 'Panenka', 'O.T. Leather', 'Black white', 140, 58.5),
  c('FU2021839A', 'Panenka', 'O.T. Leather', 'White black eagle', 140, 58.5),
  c('FU0320897A', 'Panenka', 'Suede', 'Grenat sun bark', 140, 58.5),
  c('FU0320901A', 'Panenka', 'Suede', 'Taupe pierre bark', 140, 58.5),
  c('RC0502790A', 'Recife', 'Leather (05)', 'Extra-white black', 150, 62.5),
  c('RC0502919A', 'Recife', 'Leather (05)', 'Extra-white natural', 150, 62.5),
  c('RC0502762A', 'Recife', 'Leather (05)', 'Extra-white platine', 150, 62.5),
  c('RC0322452A', 'Recife', 'Suede', 'Eagle swan', 150, 62.5),
  c('RO1821913A', 'Rio Branco', 'Alveomesh', 'Eagle sun', 140, 58.5),
  c('RO1803870A', 'Rio Branco', 'Alveomesh', 'Black white', 140, 58.5),
  c('RO1803867A', 'Rio Branco', 'Alveomesh', 'White pierre', 140, 58.5),
  c('RW3421919A', 'Rio Branco', 'Nolyn', 'Almond sahara eagle', 150, 62.5),
  c('RW3421572A', 'Rio Branco', 'Nolyn', 'Nautico pierre', 150, 62.5),
  c('RW3422308A', 'Rio Branco', 'Nolyn', 'Amarante calcaire', 150, 62.5),
  c('RW3422538A', 'Rio Branco', 'Nolyn', 'Black grafite', 150, 62.5),
  c('VI0220738A', 'V-10', 'Leather', 'Extra-white black', 155, 65),
  c('VI0220737A', 'V-10', 'Leather', 'Extra-white platine', 155, 65),
  c('VI0222456A', 'V-10', 'Leather', 'Silver black', 155, 65),
]

export const RETAILERS: Retailer[] = [
  {
    id: 'r-26shops', name: '26 Shops', zone: 'EMEA', tracked: true, segmentation: '', salesReps: [], sites: [],
  },
  {
    id: 'r-43einhalb', name: '43einhalb', zone: 'EMEA', tracked: true, segmentation: 'T2A', salesReps: ['Marcel', 'Bastian'],
    sites: [
      { currency: 'EUR', url: 'https://www.43einhalb.com/fr/marques/veja/' },
      { currency: 'EUR', url: 'https://www.43einhalb.com/en/brands/veja/' },
    ],
  },
  {
    id: 'r-afew', name: 'Afew', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Marcel', 'Bastian'], sites: [],
  },
  {
    id: 'r-alltricks', name: 'Alltricks', zone: 'EMEA', tracked: true, segmentation: 'PERF', salesReps: ['Julian', 'Eloise'],
    sites: [{ currency: 'EUR', url: 'https://www.alltricks.fr/C-1654339-veja' }],
  },
  {
    id: 'r-asphaltgold', name: 'Asphaltgold', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Marcel', 'Bastian'],
    sites: [
      { currency: 'EUR', url: 'https://www.asphaltgold.com/fr/collections/veja' },
      { currency: 'EUR', url: 'https://www.asphaltgold.com/en/collections/veja' },
    ],
  },
  {
    id: 'r-bellerose', name: 'Bellerose', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Felix'], sites: [],
  },
  {
    id: 'r-bstn', name: 'Bstn', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Nadine'], sites: [],
  },
  {
    id: 'r-maisonlacet', name: 'Maison Lacet', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Nadine'],
    sites: [{ currency: 'EUR', url: 'https://www.maisonlacet.example/marques/veja' }],
  },
  {
    id: 'r-sneakerienord', name: 'Sneakerie Nord', zone: 'EMEA', tracked: true, segmentation: 'T2A', salesReps: ['Felix'],
    sites: [
      { currency: 'EUR', url: 'https://www.sneakerienord.example/fr/veja' },
      { currency: 'EUR', url: 'https://www.sneakerienord.example/nl/veja' },
    ],
  },
  {
    id: 'r-pointesemelle', name: 'Pointe & Semelle', zone: 'EMEA', tracked: true, segmentation: 'PERF', salesReps: ['Julian', 'Eloise'],
    sites: [{ currency: 'EUR', url: 'https://www.pointeetsemelle.example/veja' }],
  },
  {
    id: 'r-atelierbaskets', name: 'Atelier Baskets', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Marcel'],
    sites: [{ currency: 'EUR', url: 'https://www.atelierbaskets.example/veja' }],
  },
  {
    id: 'r-comptoirpied', name: 'Le Comptoir Pied', zone: 'EMEA', tracked: true, segmentation: 'T2A', salesReps: ['Felix'],
    sites: [{ currency: 'EUR', url: 'https://www.lecomptoirpied.example/veja' }],
  },
  {
    id: 'r-citadium', name: 'Citadium', zone: 'EMEA', tracked: true, segmentation: 'T2A', salesReps: ['Marvin'], sites: [],
  },
  {
    id: 'r-bijenkorf', name: 'De Bijenkorf', zone: 'EMEA', tracked: true, segmentation: 'T2B', salesReps: ['Eloise', 'Felix'],
    sites: [{ currency: 'EUR', url: 'https://www.debijenkorf.nl/veja' }],
  },
  {
    id: 'r-deliberti', name: 'Deliberti', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Clothilde', 'Jeremy'],
    sites: [{ currency: 'EUR', url: 'https://delibertiboutique.com/collections/veja' }],
  },
  {
    id: 'r-flannels', name: 'Flannels', zone: 'EMEA', tracked: true, segmentation: 'T2A', salesReps: ['Ronan'],
    sites: [{ currency: 'GBP', url: 'https://www.flannels.com/search?q=veja' }],
  },
  {
    id: 'r-footdistrict', name: 'Footdistrict', zone: 'EMEA', tracked: true, segmentation: 'T2', salesReps: ['Eden', 'Jeremy'],
    sites: [{ currency: 'EUR', url: 'https://footdistrict.com/fr/veja/' }],
  },
  {
    id: 'r-footshop', name: 'Footshop', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Lena'],
    sites: [
      { currency: 'EUR', url: 'https://www.footshop.fr/fr/349_veja' },
      { currency: 'GBP', url: 'https://www.footshop.co.uk/en/349_veja' },
    ],
  },
  {
    id: 'r-galeries', name: 'Galeries Lafayette', zone: 'EMEA', tracked: true, segmentation: 'T1', salesReps: ['Marvin'],
    sites: [{ currency: 'EUR', url: 'https://www.galerieslafayette.com/veja' }],
  },
  {
    id: 'r-giglio', name: 'Giglio', zone: 'EMEA', tracked: true, segmentation: 'T2', salesReps: ['Clothilde', 'Jeremy'], sites: [],
  },
]

export const DEFAULT_RULES: Rules = {
  excludedRetailerIds: [],
}

export const SALE_PERIODS: SalePeriod[] = [
  { id: 'sp-bf', zone: 'EMEA', label: 'Black Friday', start: '2026-11-23', end: '2026-11-30', scan: { mode: 'daily' } },
  { id: 'sp-winter', zone: 'EMEA', label: "Soldes d'hiver", start: '2027-01-06', end: '2027-02-02', scan: { mode: 'weekly', days: [1, 4] } },
]

type Profile = 'strict' | 'mixed' | 'discounter'

const PROFILES: Record<string, Profile> = {
  'r-43einhalb': 'discounter',
  'r-alltricks': 'mixed',
  'r-asphaltgold': 'discounter',
  'r-maisonlacet': 'mixed',
  'r-sneakerienord': 'discounter',
  'r-pointesemelle': 'strict',
  'r-atelierbaskets': 'strict',
  'r-comptoirpied': 'mixed',
  'r-bijenkorf': 'strict',
  'r-deliberti': 'discounter',
  'r-flannels': 'mixed',
  'r-footdistrict': 'strict',
  'r-footshop': 'discounter',
  'r-galeries': 'strict',
}

const COLOR_FR: [RegExp, string][] = [
  [/White/g, 'Blanc'],
  [/Black/g, 'Noir'],
  [/Pierre/g, 'Pierre'],
  [/Kaki/g, 'Kaki'],
  [/Sand/g, 'Sable'],
]

function frenchTitle(item: CatalogItem): string {
  let color = item.color
  for (const [re, fr] of COLOR_FR) color = color.replace(re, fr)
  return `VEJA ${item.model} ${color}`.toUpperCase()
}

function pickDiscount(profile: Profile, r: () => number): number {
  const x = r()
  if (profile === 'strict') return x < 0.92 ? 0 : 5
  if (profile === 'mixed') {
    if (x < 0.6) return 0
    if (x < 0.85) return [10, 15][Math.floor(r() * 2)]
    return [25, 30, 35][Math.floor(r() * 3)]
  }
  if (x < 0.25) return 0
  return [20, 25, 30, 35, 40][Math.floor(r() * 5)]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function buildObservations(): Observation[] {
  const r = mulberry32(2026)
  const out: Observation[] = []
  for (const retailer of RETAILERS) {
    if (retailer.sites.length === 0) continue
    const profile = PROFILES[retailer.id] ?? 'mixed'
    const count = 14 + Math.floor(r() * 9)
    const shuffled = [...CATALOG].sort(() => r() - 0.5).slice(0, count)
    shuffled.forEach((item, idx) => {
      // Le produit est vu sur l'une des pages du compte ; ses prix se comparent au RRP de la devise de cette page.
      const site = retailer.sites[Math.floor(r() * retailer.sites.length)]
      const rrp = item.rrp[site.currency] ?? item.rrp.EUR ?? 0
      const d = pickDiscount(profile, r)
      const k = 1 + Math.floor(r() * 6)
      const history = WEEKS.map((week, i) => {
        let pct = 0
        if (d > 0) {
          if (profile === 'discounter') {
            if (i >= k + 2) pct = d
            else if (i >= k) pct = Math.round(d / 2)
          } else if (i >= k) pct = d
        }
        const price = pct > 0 ? Math.round(rrp * (1 - pct / 100)) - 0.01 : rrp
        return { week, price: round2(price) }
      })
      const current = history[history.length - 1].price
      const toReview = current < rrp && r() < 0.2
      let candidateSku = item.sku
      if (toReview && r() < 0.3) {
        const alt = CATALOG.find(
          (x) => x.model === item.model && x.sku !== item.sku && x.rrp.EUR === item.rrp.EUR,
        )
        if (alt) candidateSku = alt.sku
      }
      out.push({
        id: `${retailer.id}-${idx}`,
        retailerId: retailer.id,
        title: toReview ? frenchTitle(item) : `Veja ${item.model} ${item.color}`,
        url: `${site.url.replace(/\/$/, '')}/${item.sku.toLowerCase()}`,
        currency: site.currency,
        model: item.model,
        color: item.color,
        sku: toReview ? undefined : item.sku,
        rrp,
        originalPrice: current < rrp && r() < 0.7 ? rrp : undefined,
        history,
        proof: toReview ? 'to-review' : 'confirmed',
        candidate: toReview ? { sku: candidateSku, confidence: round2(0.55 + r() * 0.35) } : undefined,
      })
    })
  }
  return out
}

export const OBSERVATIONS: Observation[] = buildObservations()
