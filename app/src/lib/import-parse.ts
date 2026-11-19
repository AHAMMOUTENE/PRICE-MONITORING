/**
 * Lecture d'un fichier à importer, dans le navigateur : Excel (.xlsx) ou CSV.
 * Le résultat est une grille de textes, avec l'en-tête détecté et les liens des cellules
 * (le fichier de suivi porte souvent le site web en lien sur le nom du compte).
 */
export type CsvDelimiter = ';' | ',' | '\t'

export interface Sheet {
  fileName: string
  /** Séparateur utilisé, pour un CSV. */
  delimiter?: CsvDelimiter
  /** Onglets du classeur (xlsx) et celui qui a été lu. */
  sheets: string[]
  sheet?: string
  header: string[]
  rows: string[][]
  /** Lien hypertexte de chaque cellule, quand il y en a un (xlsx seulement). */
  links: (string | undefined)[][]
}

export interface ReadOptions {
  delimiter?: CsvDelimiter
  /** Onglet à lire ; sinon le premier. */
  sheet?: string
  /** Noms de colonnes attendus : l'en-tête est la première ligne qui en contient un (les lignes de titre sont sautées). */
  expected?: string[]
}

export class UnsupportedFile extends Error {
  constructor(public readonly reason: 'format' | 'xlsOld') {
    super(reason)
  }
}

export async function readSheet(file: File, options: ReadOptions = {}): Promise<Sheet> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xls')) throw new UnsupportedFile('xlsOld')
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(file, options)
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv') || file.type.includes('csv') || file.type.startsWith('text/')) return readCsv(file, options)
  throw new UnsupportedFile('format')
}

/* ───────── CSV ───────── */

function detectDelimiter(firstLine: string): CsvDelimiter {
  const candidates: CsvDelimiter[] = [';', ',', '\t']
  let best: CsvDelimiter = ';'
  let max = -1
  for (const d of candidates) {
    const n = firstLine.split(d).length - 1
    if (n > max) {
      max = n
      best = d
    }
  }
  return best
}

export function parseCsv(raw: string, forced?: CsvDelimiter): { rows: string[][]; delimiter: CsvDelimiter } {
  const text = raw.replace(/^﻿/, '')
  const delim = forced ?? detectDelimiter(text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 5).join('\n'))
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return { rows: rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== '')), delimiter: delim }
}

async function readCsv(file: File, options: ReadOptions): Promise<Sheet> {
  const { rows: grid, delimiter: used } = parseCsv(await file.text(), options.delimiter)
  return { ...splitHeader(file.name, grid, grid.map((r) => r.map(() => undefined)), options.expected), delimiter: used }
}

/* ───────── XLSX ───────── */

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim()
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('').trim()
    if ('result' in o) return cellText(o.result)
    if ('text' in o) return cellText(o.text)
    if ('hyperlink' in o) return String(o.hyperlink).trim()
  }
  return ''
}

function cellLink(v: unknown): string | undefined {
  if (v && typeof v === 'object' && 'hyperlink' in (v as Record<string, unknown>)) {
    const h = String((v as { hyperlink: unknown }).hyperlink).trim()
    return /^https?:\/\//i.test(h) ? h : undefined
  }
  return undefined
}

async function readXlsx(file: File, options: ReadOptions): Promise<Sheet> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const sheets = wb.worksheets.filter((w) => w.state !== 'hidden' && w.rowCount > 0).map((w) => w.name)
  const ws = (options.sheet && wb.getWorksheet(options.sheet)) || wb.worksheets.find((w) => w.name === sheets[0])
  if (!ws) return { fileName: file.name, sheets, header: [], rows: [], links: [] }
  const grid: string[][] = []
  const links: (string | undefined)[][] = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cells: string[] = []
    const rowLinks: (string | undefined)[] = []
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellText(cell.value)
      rowLinks[col - 1] = cellLink(cell.value) ?? (cell.hyperlink && /^https?:\/\//i.test(cell.hyperlink) ? cell.hyperlink : undefined)
    })
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    if (cells.some((c) => c !== '')) {
      grid.push(cells)
      links.push(rowLinks)
    }
  }
  return { ...splitHeader(file.name, grid, links, options.expected), sheets, sheet: ws.name }
}

/**
 * L'en-tête est la première ligne qui contient une colonne attendue (« STORE », « SKU »…) :
 * les lignes de titre au-dessus (ex. « VEJA IMAGE ONLINE ») sont sautées.
 * Sans colonne attendue, c'est la première ligne qui a au moins deux cellules remplies.
 */
function splitHeader(fileName: string, grid: string[][], links: (string | undefined)[][], expected?: string[]): Sheet {
  const wanted = new Set((expected ?? []).map(normHeader))
  const looksLikeHeader = (r: string[]) => r.filter((c) => c !== '').length >= 2 && r.some((c) => wanted.has(normHeader(c)) || /^rrp\b/.test(normHeader(c)))
  let h = wanted.size ? grid.findIndex(looksLikeHeader) : -1
  if (h < 0) h = grid.findIndex((r) => r.filter((c) => c !== '').length >= 2)
  if (h < 0) return { fileName, sheets: [], header: [], rows: [], links: [] }
  return { fileName, sheets: [], header: grid[h], rows: grid.slice(h + 1), links: links.slice(h + 1) }
}

/* ───────── Reconnaissance des colonnes ───────── */

export function normHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-./()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pour chaque champ attendu, l'index de la colonne qui lui correspond (ou -1). */
export function mapColumns(header: string[], aliases: Record<string, string[]>): Record<string, number> {
  const norm = header.map(normHeader)
  const out: Record<string, number> = {}
  for (const [field, names] of Object.entries(aliases)) {
    out[field] = -1
    for (const n of names) {
      const i = norm.indexOf(normHeader(n))
      if (i >= 0) {
        out[field] = i
        break
      }
    }
  }
  return out
}

export const ACCOUNT_COLUMNS: Record<string, string[]> = {
  name: ['store name', 'store', 'account', 'compte', 'revendeur', 'retailer', 'nom', 'client', 'name'],
  website: ['store website', 'website', 'site web', 'site', 'url', 'web'],
  currency: ['currency', 'devise', 'moeda', 'moneda'],
  segmentation: ['segmentation', 'segment', 'segmentacao', 'segmentacion', 'tier'],
  rep: ['sales rep', 'salesrep', 'rep', 'commercial', 'vendeur'],
}

/**
 * Colonnes du catalogue. Les fichiers VEJA (« MASTERFILE », « CARRY OVER LIST ») ont une ligne par taille :
 * `sku` (9 caractères) + la lettre du département forment la référence suivie (`generic`), lisible aussi
 * dans la référence complète (`reference`, référence + taille).
 */
export const CATALOG_COLUMNS: Record<string, string[]> = {
  sku: ['sku', 'référence', 'ref', 'article'],
  generic: ['generic', 'generique', 'style'],
  reference: ['reference', 'product', 'full reference', 'reference complete'],
  model: ['model', 'modele', 'modèle', 'modelo'],
  material: ['material', 'matiere', 'matière', 'fabric', 'matter'],
  color: ['color', 'colour', 'couleur', 'cor'],
  season: ['season', 'saison', 'temporada', 'estacao', 'collection'],
  seasonality: ['seasonality', 'saisonnalite', 'carry over', 'carryover', 'c o'],
  dept: ['department group', 'department', 'dept', 'departement', 'rayon'],
  maxDiscount: ['max discount %', 'max discount', 'maximum discount', 'discount max', 'remise max', 'remise maximale', 'remise autorisee', 'desconto maximo', 'descuento maximo'],
  segmentation: ['segmentation', 'segment', 'tier'],
  colorCode: ['nrf color code', 'color code', 'colour code', 'code couleur'],
  description: ['product description', 'description', 'designation'],
  composition: ['composition', 'materials'],
  origin: ['country of origin', 'origin', 'origine', 'pays d origine'],
  ean: ['ean code', 'ean codes', 'ean', 'barcode', 'gtin'],
}

const CURRENCY_SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP', '$': 'USD', '¥': 'JPY', '₩': 'KRW', 'r$': 'BRL' }
/** Codes mal orthographiés rencontrés dans les fichiers VEJA. */
const CURRENCY_FIXES: Record<string, string> = { MXD: 'MXN' }
const PRICE_WORDS = {
  rrp: /^(?:rrp|prix de reference|retail price|recommended retail price|pvp|preco de referencia|rrp oficial)\s*([a-z]{3})?$/,
  wholesale: /^(?:unit price|whs|wholesale|wholesale price|prix de gros|preco de atacado|precio mayorista)\s*([a-z]{3})?$/,
}

/**
 * Colonnes de prix, une par devise : « RRP EUR », « RRP £ », « UNIT PRICE GBP », « WHS USD »…
 * Sans devise, la colonne vaut pour `mainCurrency`. Renvoie devise → index de colonne.
 */
export function priceColumns(header: string[], mainCurrency: string, kind: keyof typeof PRICE_WORDS): Record<string, number> {
  const out: Record<string, number> = {}
  header.forEach((h, i) => {
    let n = normHeader(h)
    for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) if (n.endsWith(sym)) n = `${n.slice(0, -sym.length).trim()} ${code.toLowerCase()}`
    const m = n.match(PRICE_WORDS[kind])
    if (m) {
      const code = (m[1] ?? mainCurrency).toUpperCase()
      out[CURRENCY_FIXES[code] ?? code] = i
    }
  })
  return out
}

export const rrpColumns = (header: string[], mainCurrency: string) => priceColumns(header, mainCurrency, 'rrp')

/**
 * L'identité d'un produit VEJA tient dans les 9 premiers caractères (« AI0221652 »). La lettre qui suit dans la
 * référence complète (« AI0221652A350 » → A) distingue femme, homme, enfant… : c'est une variante du même produit.
 */
export function splitSku(sku: string, reference: string): { sku: string; variant: string } {
  const s = sku.trim().toUpperCase().slice(0, 9)
  const r = reference.trim().toUpperCase()
  const v = r.startsWith(s) ? r.charAt(9) : s.length === 9 && sku.trim().length > 9 ? sku.trim().toUpperCase().charAt(9) : ''
  return { sku: s, variant: /^[A-Z]$/.test(v) ? v : '' }
}

/** Saison lisible dans un nom d'onglet ou de fichier : « AW26 CARRY OVER LIST » → « AW26 ». */
export function seasonFromName(...names: (string | undefined)[]): string {
  for (const n of names) {
    const m = n?.toUpperCase().match(/\b(SS|AW|FW)\s?(\d{2})\b/)
    if (m) return `${m[1]}${m[2]}`
  }
  return ''
}

/** « CARRY OVER » / « SEASONAL » (colonne SEASONALITY, ou SEASON dans les fichiers SS27). */
export function seasonalityOf(v: string): 'carry-over' | 'seasonal' | null {
  const n = normHeader(v)
  if (/carry/.test(n) || n === 'c o' || n === 'co') return 'carry-over'
  if (/seasonal|saisonnier|permanent/.test(n)) return 'seasonal'
  return null
}

/** « WHITE_NATURAL » → « White natural » ; « Black white » reste tel quel. */
export function prettyColor(v: string): string {
  const s = v.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  if (s === s.toUpperCase()) return s.charAt(0) + s.slice(1).toLowerCase()
  return s
}

/** « 1 250,50 », « €140.00 », « 140 » → 140 ; vide ou illisible → undefined. */
export function parseAmount(v: string): number | undefined {
  const s = v.replace(/[^\d,.\-]/g, '')
  if (!s) return undefined
  // « 1,250 » ou « R$ 1.200 » : un séparateur suivi d'exactement trois chiffres est un séparateur de milliers.
  if (/^-?[1-9]\d{0,2}([.,]\d{3})+$/.test(s)) return parseFloat(s.replace(/[.,]/g, ''))
  let n = s
  if (n.includes(',') && n.includes('.')) n = n.lastIndexOf(',') > n.lastIndexOf('.') ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '')
  else if (n.includes(',')) n = n.replace(',', '.')
  const f = parseFloat(n)
  return Number.isFinite(f) ? f : undefined
}
