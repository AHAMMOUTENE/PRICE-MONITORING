/**
 * Transforme les fichiers métier (FOLLOW UP IMAGE ONLINE, MASTERFILE / CARRY OVER LIST) en SQL pour Supabase,
 * avec exactement la logique de l'import de l'application (SKU sur 9 caractères, variantes, prix par devise,
 * carry-over = non soldé, devise de chaque page déduite de l'adresse).
 *
 * Usage (depuis app/) :
 *   npx tsx scripts/build-seed.mts <ZONE> <comptes.xlsx> <catalogue.xlsx> [onglet ...]
 * Sans onglet, tous ceux dont le nom contient « AW26 » sont lus. Sortie : ../supabase/seed/*.sql
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { mockApi } from '../src/api/index.ts'
import type { CatalogItem } from '../src/types.ts'

const [zone, accountsPath, catalogPath, ...sheetsArg] = process.argv.slice(2)
if (!zone || !accountsPath || !catalogPath) {
  console.error('Usage : npx tsx scripts/build-seed.mts <ZONE> <comptes.xlsx> <catalogue.xlsx> [onglet ...]')
  process.exit(1)
}
if (!['EMEA', 'LATAM', 'APAC', 'NOAM'].includes(zone)) throw new Error(`Zone inconnue : ${zone}`)

const out = resolve(process.cwd(), '../supabase/seed')
await mkdir(out, { recursive: true })
const load = async (p: string) => new File([await readFile(p)], basename(p))
const q = (v: string) => `'${v.replace(/'/g, "''")}'`
const qn = (v: string | undefined) => (v ? q(v) : 'null')
const money = (n: number) => n.toFixed(2)
const URL_OK = /^https?:\/\/[^\s/]+\.[^\s]+$/i
const warnings: string[] = []

// ───────── Comptes et pages ─────────
// Les comptes de démonstration de la zone sont retirés pour ne laisser que les vrais.
for (const r of await mockApi.listRetailers(zone)) await mockApi.removeRetailer(r.id)
const accountsFile = await load(accountsPath)
const preview = await mockApi.previewRetailerImport(accountsFile, zone)
if (!preview.canImport) throw new Error(`Fichier des comptes illisible : ${JSON.stringify(preview.warnings)}`)
await mockApi.commitImport(preview.token)
const retailers = await mockApi.listRetailers(zone)

const accountRows = retailers.map((r) => `  (${q(zone)}, ${q(r.name.trim())}, ${q(r.segmentation)}, ${r.salesReps.length ? `array[${r.salesReps.map(q).join(', ')}]::text[]` : "'{}'::text[]"}, ${r.tracked}, false)`)
const siteRows: string[] = []
for (const r of retailers) {
  r.sites.forEach((s, i) => {
    if (!URL_OK.test(s.url) || !/^[A-Z]{3}$/.test(s.currency)) {
      warnings.push(`Page ignorée (adresse ou devise invalide) : ${r.name} → ${s.url} [${s.currency}]`)
      return
    }
    siteRows.push(`  (${q(r.name.trim())}, ${q(s.currency)}, ${q(s.url)}, ${i})`)
  })
}
await writeFile(
  `${out}/01_accounts.sql`,
  `-- Comptes et pages de site (zone ${zone}) — source : ${basename(accountsPath)}. Peut être relancé : les comptes existants sont mis à jour.
insert into accounts (zone_id, name, segmentation, sales_reps, tracked, excluded) values
${accountRows.join(',\n')}
on conflict (zone_id, lower(btrim(name))) where status = 'active'
do update set segmentation = excluded.segmentation, sales_reps = excluded.sales_reps, updated_at = now();

insert into account_sites (account_id, zone_id, currency, url, position)
select a.id, a.zone_id, v.currency, v.url, v.position
from (values
${siteRows.join(',\n')}
) as v(name, currency, url, position)
join accounts a on a.zone_id = ${q(zone)} and a.status = 'active' and lower(btrim(a.name)) = lower(btrim(v.name))
on conflict (account_id, url) do nothing;
`,
  'utf-8',
)

// ───────── Catalogue ─────────
// Importé dans une zone vide (sans données de démonstration), puis écrit pour la zone demandée.
const scratch = zone === 'LATAM' ? 'APAC' : 'LATAM'
const catalogFile = await load(catalogPath)
const first = await mockApi.previewCatalogImport(catalogFile, scratch)
const sheets = sheetsArg.length ? sheetsArg : (first.sheets ?? [first.sheet ?? '']).filter((s) => /AW26/i.test(s))
for (const sheet of sheets) {
  const p = await mockApi.previewCatalogImport(catalogFile, scratch, { sheet })
  if (!p.canImport) {
    warnings.push(`Onglet ignoré « ${sheet} » : ${JSON.stringify(p.warnings)}`)
    continue
  }
  await mockApi.commitImport(p.token)
  console.log(`onglet « ${sheet} » : ${p.rows} produits lus (saison ${p.season}, non soldés : ${p.noDiscount})`)
}
const catalog = (await mockApi.listCatalog(scratch)).filter((c: CatalogItem) => {
  if (/^[A-Z0-9]{9}$/.test(c.sku)) return true
  warnings.push(`Produit ignoré (SKU invalide) : ${c.sku}`)
  return false
})

const productRows = catalog.map((c) => {
  const season = /^[A-Z0-9/]{2,8}$/.test(c.season) ? c.season : ''
  const ean = c.ean && /^[0-9]{8,14}$/.test(c.ean) ? c.ean : undefined
  const variants = c.variants?.length ? `array[${c.variants.map(q).join(', ')}]::text[]` : "'{}'::text[]"
  const rule = c.maxDiscountPct === undefined ? 'null' : String(c.maxDiscountPct)
  return `  (${q(zone)}, ${q(c.sku)}, ${variants}, ${q(c.model)}, ${q(c.material)}, ${q(c.color)}, ${q(c.dept ?? '')}, ${q(season)}, ${Boolean(c.carryOver)}, ${rule}, ${qn(c.segmentation)}, ${qn(c.colorCode)}, ${qn(c.description)}, ${qn(c.composition)}, ${qn(c.origin)}, ${qn(ean)})`
})
// Un fichier de produits par paquet de 250, pour rester confortable dans l'éditeur SQL.
const CHUNK = 250
for (let i = 0; i < productRows.length; i += CHUNK) {
  const n = String(Math.floor(i / CHUNK) + 1).padStart(2, '0')
  await writeFile(
    `${out}/02_products_${n}.sql`,
    `-- Produits (zone ${zone}), paquet ${n}. Peut être relancé : les produits existants sont mis à jour.
insert into products (zone_id, sku, variants, model, material, color, dept, season, carry_over, max_discount_pct, segmentation, color_code, description, composition, origin, ean) values
${productRows.slice(i, i + CHUNK).join(',\n')}
on conflict (zone_id, sku) do update set
  variants = excluded.variants, model = excluded.model, material = excluded.material, color = excluded.color, dept = excluded.dept,
  season = excluded.season, carry_over = excluded.carry_over, max_discount_pct = excluded.max_discount_pct, segmentation = excluded.segmentation,
  color_code = excluded.color_code, description = excluded.description, composition = excluded.composition, origin = excluded.origin, ean = excluded.ean,
  updated_at = now();
`,
    'utf-8',
  )
}

// Prix : une ligne par produit, devise et nature (RRP, prix wholesale).
const priceRows: string[] = []
for (const c of catalog) {
  for (const [cur, v] of Object.entries(c.rrp)) if (/^[A-Z]{3}$/.test(cur) && v && v > 0) priceRows.push(`  (${q(c.sku)}, ${q(cur)}, 'rrp', ${money(v)})`)
  for (const [cur, v] of Object.entries(c.wholesale)) if (/^[A-Z]{3}$/.test(cur) && v && v > 0) priceRows.push(`  (${q(c.sku)}, ${q(cur)}, 'wholesale', ${money(v)})`)
}
const PCHUNK = 2000
for (let i = 0; i < priceRows.length; i += PCHUNK) {
  const n = String(Math.floor(i / PCHUNK) + 1).padStart(2, '0')
  await writeFile(
    `${out}/03_prices_${n}.sql`,
    `-- Prix RRP et wholesale par devise (zone ${zone}), paquet ${n}. À lancer après les fichiers 02. Peut être relancé.
insert into product_prices (product_id, zone_id, currency, kind, amount, source)
select p.id, p.zone_id, v.currency, v.kind::price_kind, v.amount, 'import'
from (values
${priceRows.slice(i, i + PCHUNK).join(',\n')}
) as v(sku, currency, kind, amount)
join products p on p.zone_id = ${q(zone)} and p.sku = v.sku
on conflict (product_id, currency, kind) do update set amount = excluded.amount, source = 'import', updated_at = now();
`,
    'utf-8',
  )
}

console.log(`\nZone ${zone} : ${retailers.length} comptes, ${siteRows.length} pages, ${catalog.length} produits, ${priceRows.length} prix.`)
console.log(`Fichiers écrits dans ${out}`)
if (warnings.length) console.log(`\n${warnings.length} avertissement(s) :\n- ${warnings.join('\n- ')}`)
