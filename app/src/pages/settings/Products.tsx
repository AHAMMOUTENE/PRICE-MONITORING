import { useEffect, useState } from 'react'
import { api } from '../../api'
import { HScroll } from '../../components/HScroll'
import { Icon } from '../../components/Icon'
import { ImportDrawer } from '../../components/ImportDrawer'
import { useToast } from '../../components/toast'
import { CurrencySelect } from '../../components/CurrencySelect'
import { Card, Drawer, Empty, ErrorBlock, LoadingBlock, PageHeader, ProductImage } from '../../components/ui'
import { refresh, useQuery, useZone } from '../../lib/app'
import { CURRENCIES } from '../../lib/currencies'
import { formatMoney } from '../../lib/format'
import { matchNumber } from '../../lib/grid'
import { ZONES, zoneInfo } from '../../lib/zones'
import { useT } from '../../lib/i18n'
import { useRoute } from '../../lib/router'
import { sortBy, SortTh, useSort } from '../../lib/sort'
import type { CatalogItem, Currency, Zone } from '../../types'

/** Remises proposées pour la règle d'un produit, en plus de « par défaut » et « non soldé ». */
const RULE_STEPS = [10, 15, 20, 25, 30, 40, 50]
/** Le choix de colonnes est propre à chaque zone : les devises d'EMEA ne s'imposent pas à APAC. */
const storageKey = (zone: string) => `pm.catalogCols.v3.${zone}`

type TextCol = 'model' | 'material' | 'color' | 'dept' | 'season' | 'segmentation' | 'colorCode' | 'description' | 'composition' | 'origin' | 'ean'
type FixedCol = 'sku' | 'variants' | TextCol | 'carryOver' | 'rule'
type ColKey = FixedCol | `rrp:${string}` | `whs:${string}`
const FIXED: FixedCol[] = ['sku', 'variants', 'model', 'material', 'color', 'colorCode', 'dept', 'segmentation', 'season', 'carryOver', 'rule', 'description', 'composition', 'origin', 'ean']
const isNumCol = (k: ColKey) => k.startsWith('rrp:') || k.startsWith('whs:')

/** Vues prêtes à l'emploi ; l'utilisateur peut ensuite cocher ses colonnes, et son choix est mémorisé. */
const VIEWS: Record<'essential' | 'prices' | 'all', (currencies: Currency[]) => ColKey[]> = {
  essential: (c) => ['sku', 'season', 'carryOver', 'rule', `rrp:${c[0] ?? 'EUR'}`],
  prices: (c) => ['sku', ...c.map((x): ColKey => `whs:${x}`), ...c.map((x): ColKey => `rrp:${x}`)],
  all: (c) => [...FIXED, ...c.flatMap((x): ColKey[] => [`whs:${x}`, `rrp:${x}`])],
}

function readCols(zone: string): ColKey[] | null {
  try {
    const raw = localStorage.getItem(storageKey(zone))
    return raw ? (JSON.parse(raw) as ColKey[]) : null
  } catch {
    return null
  }
}

/**
 * Catalogue produits : toutes les données du fichier, une colonne chacune, modifiables sur place
 * (clic dans une cellule, Entrée ou clic ailleurs pour enregistrer). Sous l'en-tête, une ligne de filtres
 * par colonne (texte contenu, liste de valeurs, ou borne pour les prix) ; les colonnes affichées se choisissent.
 */
export function ProductsSettings() {
  const { t } = useT()
  const { zone } = useZone()
  const catalog = useQuery(() => api.listCatalog(zone), [zone])
  const zoneCurrencies = useQuery(() => api.listCurrencies(zone), [zone])
  const { params } = useRoute()
  const importParam = params.get('import') === '1' // le tutoriel ouvre l'import pour montrer le modèle
  const [importing, setImporting] = useState(importParam)
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null) // produit ouvert dans le panneau de droite
  useEffect(() => setImporting(importParam), [importParam])
  const { sort, toggle } = useSort()
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [cols, setColsState] = useState<ColKey[] | null>(() => readCols(zone))
  useEffect(() => setColsState(readCols(zone)), [zone])

  if (catalog.error) return <div className="page"><ErrorBlock message={catalog.error} onRetry={refresh} /></div>
  if (!catalog.data || !zoneCurrencies.data) return <div className="page"><LoadingBlock /></div>

  // Devises du catalogue : celles des sites de la zone d'abord, puis toutes celles qui ont un prix dans le fichier.
  const inCatalog = new Set<Currency>()
  for (const c of catalog.data) for (const cur of [...Object.keys(c.rrp), ...Object.keys(c.wholesale)]) inCatalog.add(cur)
  // Le catalogue est commun à toutes les zones : on affiche les prix de toutes les devises présentes, groupés par zone.
  const zoneIds = [zone, ...ZONES.map((z) => z.id).filter((z) => z !== zone)]
  const known = zoneIds.flatMap((z) => zoneInfo(z).currencies)
  // La devise de la zone est toujours proposée (même sans prix encore), pour pouvoir la remplir.
  const wanted = (c: Currency) => inCatalog.has(c) || zoneCurrencies.data!.includes(c) || c === zoneInfo(zone).defaultCurrency
  const groups = zoneIds.map((z) => ({ zone: z, cur: zoneInfo(z).currencies.filter(wanted) })).filter((g) => g.cur.length > 0)
  const others = [...inCatalog].filter((c) => !known.includes(c) && !CURRENCIES.includes(c))
  const currencies = [...groups.flatMap((g) => g.cur), ...others]
  const here = groups.find((g) => g.zone === zone)?.cur ?? currencies.slice(0, 3) // devises de la zone consultée
  const priceKeys = (cur: Currency[]): ColKey[] => cur.flatMap((x): ColKey[] => [`rrp:${x}`, `whs:${x}`])
  const allCols: ColKey[] = VIEWS.all(currencies)
  const defaultCols: ColKey[] = ['sku', 'model', 'color', 'season', 'carryOver', 'rule', ...priceKeys(here)]
  const shown: ColKey[] = (cols ?? defaultCols).filter((k) => allCols.includes(k))
  const setCols = (next: ColKey[]) => {
    setColsState(next)
    try {
      localStorage.setItem(storageKey(zone), JSON.stringify(next))
    } catch {
      /* non mémorisé */
    }
  }
  const has = (k: ColKey) => shown.includes(k)
  const colLabel = (k: ColKey): string => {
    if (k.startsWith('rrp:')) return `RRP ${k.slice(4)}`
    if (k.startsWith('whs:')) return `${t('col.wholesaleShort')} ${k.slice(4)}`
    const map: Record<FixedCol, string> = {
      sku: t('col.sku'), variants: t('col.variants'), model: t('col.model'), material: t('col.material'), color: t('col.color'), colorCode: t('col.colorCode'), dept: t('col.dept'), segmentation: t('col.segmentation'),
      season: t('col.season'), carryOver: t('col.carryOver'), rule: t('col.rule'), description: t('col.description'), composition: t('col.composition'), origin: t('col.origin'), ean: t('col.ean'),
    }
    return map[k as FixedCol]
  }

  /** Valeur d'une colonne, pour le tri, les filtres et les listes de choix. */
  const cell = (c: CatalogItem, k: ColKey): string | number | null => {
    if (k === 'sku') return c.sku
    if (k === 'variants') return c.variants?.join(' ') || null
    if (k === 'carryOver') return c.carryOver ? t('pill.carryOver') : '—'
    if (k === 'rule') return c.maxDiscountPct === undefined ? t('rule.unset') : c.maxDiscountPct === 0 ? t('rule.none') : `${c.maxDiscountPct} %`
    if (k.startsWith('rrp:')) return c.rrp[k.slice(4)] ?? null
    if (k.startsWith('whs:')) return c.wholesale[k.slice(4)] ?? null
    return c[k as TextCol] || null
  }
  const CHOICE = new Set<ColKey>(['dept', 'season', 'segmentation', 'carryOver', 'rule', 'origin', 'variants', 'material', 'model'])
  const choices = (k: ColKey) => [...new Set(catalog.data!.map((c) => String(cell(c, k) ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const active = Object.entries(filters).filter(([, v]) => v)
  const rows = sortBy(
    catalog.data.filter((c) =>
      active.every(([k, v]) => {
        const key = k as ColKey | 'product'
        if (key === 'product') return `${c.sku} ${c.model} ${c.material} ${c.color} ${c.description ?? ''}`.toLowerCase().includes(v.toLowerCase())
        const value = cell(c, key)
        if (isNumCol(key)) return matchNumber(typeof value === 'number' ? value : null, v)
        if (CHOICE.has(key)) return String(value ?? '') === v
        return String(value ?? '').toLowerCase().includes(v.toLowerCase())
      }),
    ),
    sort,
    {
      product: (c) => `${c.model} ${c.color}`,
      carryOver: (c) => (c.carryOver ? 0 : 1),
      rule: (c) => c.maxDiscountPct ?? null,
      ...Object.fromEntries(allCols.filter((k) => k !== 'carryOver' && k !== 'rule').map((k) => [k, (c: CatalogItem) => cell(c, k)])),
    },
  )

  return (
    <div className="page">
      <PageHeader
        title={t('sProducts.title')}
        subtitle={`${t('count.product', { n: catalog.data.length })} · ${t('sProducts.editHint')}`}
        actions={
          <>
            <button className="btn btn-secondary" data-tour="import-catalog" onClick={() => setImporting(true)}>
              <Icon name="upload" /> {t('sProducts.import')}
            </button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" /> {t('sProducts.add')}
            </button>
          </>
        }
      />

      <div className="toolbar">
        {active.length > 0 && (
          <span className="filter-count">
            {t('filter.showing', { shown: rows.length, total: catalog.data.length })}
            <button className="linkbtn linkbtn-inline" onClick={() => setFilters({})}>
              {t('filter.reset')}
            </button>
          </span>
        )}
        <details className="colpick">
          <summary className="btn btn-secondary btn-sm">
            <Icon name="grid" /> {t('sProducts.columns')} <em>{shown.length}</em>
          </summary>
          <div className="colpick-menu">
            <div className="seg" role="group" aria-label={t('sProducts.columns')}>
              {(['essential', 'prices', 'all'] as const).map((v) => (
                <button key={v} aria-pressed={JSON.stringify(VIEWS[v](v === 'all' ? currencies : here)) === JSON.stringify(shown)} onClick={() => setCols(VIEWS[v](v === 'all' ? currencies : here))}>
                  {t(`sProducts.view.${v}` as const)}
                </button>
              ))}
            </div>
            <div className="colpick-list">
              {allCols.map((k) => (
                <label key={k}>
                  <input type="checkbox" checked={has(k)} onChange={(e) => setCols(e.target.checked ? allCols.filter((x) => x === k || has(x)) : shown.filter((x) => x !== k))} />
                  {colLabel(k)}
                </label>
              ))}
            </div>
          </div>
        </details>
      </div>

      <Card flush>
        <HScroll tour="catalog-table">
          <table className="table table-rows table-edit">
            <thead>
              <tr className="head-titles">
                <SortTh col="product" label={t('col.product')} sort={sort} onSort={toggle} />
                {shown.map((k) => (
                  <SortTh key={k} col={k} label={colLabel(k)} sort={sort} onSort={toggle} numeric={isNumCol(k) || k === 'rule'} className={isNumCol(k) ? 'num' : undefined} />
                ))}
                <th aria-label={t('common.edit')} />
              </tr>
              <tr className="filter-row">
                <th scope="col">
                  <input className="cell-filter" type="search" aria-label={t('sProducts.search')} placeholder={t('sProducts.search')} value={filters.product ?? ''} onChange={(e) => setFilters({ ...filters, product: e.target.value })} />
                </th>
                {shown.map((k) => (
                  <th key={k} scope="col">
                    {CHOICE.has(k) ? (
                      <select className="cell-filter" aria-label={colLabel(k)} value={filters[k] ?? ''} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}>
                        <option value="">{t('filter.all')}</option>
                        {choices(k).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input className={`cell-filter${isNumCol(k) ? ' num' : ''}`} type="search" aria-label={colLabel(k)} placeholder={isNumCol(k) ? t('filter.numPlaceholder') : t('filter.textPlaceholder')} title={isNumCol(k) ? t('filter.numHint') : undefined} value={filters[k] ?? ''} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })} />
                    )}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={shown.length + 2}>
                    <Empty title={t('sProducts.noMatch')} />
                  </td>
                </tr>
              )}
              {rows.map((c) => (
                <tr key={c.sku} className="is-clickable" onClick={() => setEditing(c)}>
                  <td>
                    <span className="cell-account">
                      <ProductImage src={c.image} sku={c.sku} color={c.color} label={c.model} size={40} />
                      <span>
                        <b>{c.model}</b>
                        <small>{c.color}</small>
                      </span>
                    </span>
                  </td>
                  {shown.map((k) => {
                    if (k === 'variants') return <td key={k} className="muted">{c.variants?.join(' · ') || '—'}</td>
                    if (k === 'sku') return <td key={k} className="muted">{c.sku}</td>
                    if (k === 'carryOver') return <td key={k}>{c.carryOver ? t('pill.carryOver') : '—'}</td>
                    if (k === 'rule') return <td key={k}>{cell(c, 'rule')}</td>
                    if (k.startsWith('rrp:') || k.startsWith('whs:')) {
                      const cur = k.slice(4)
                      const v = k.startsWith('rrp:') ? c.rrp[cur] : c.wholesale[cur]
                      return <td key={k} className="num">{v === undefined ? <span className="muted">—</span> : formatMoney(v, cur)}</td>
                    }
                    const text = c[k as TextCol]
                    return <td key={k}>{text || <span className="muted">—</span>}</td>
                  })}
                  <td className="num">
                    <button className="iconbtn" aria-label={`${t('common.edit')} ${c.sku}`} title={t('common.edit')} onClick={(e) => (e.stopPropagation(), setEditing(c))}>
                      <Icon name="edit" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      </Card>

      {editing && <ProductDrawer zone={zone} initial={editing === 'new' ? undefined : editing} currencies={currencies} onClose={() => setEditing(null)} />}

      {importing && (
        <ImportDrawer
          title={t('import.catalogTitle')}
          hint={t('import.catalogHint', { columns: ['SEASON', 'SEASONALITY', 'MAX DISCOUNT %', ...currencies.map((c) => `UNIT PRICE ${c}`), ...currencies.map((c) => `RRP ${c}`)].join(', ') })}
          template="catalog"
          onPreview={(f, o) => api.previewCatalogImport(f, zone, o)}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  )
}

const TEXT_FIELDS = ['dept', 'segmentation', 'colorCode', 'ean', 'description', 'composition', 'origin'] as const

/**
 * Panneau de droite pour ajouter ou modifier un produit (comme pour les retailers).
 * Ajout : SKU de 9 caractères (une lettre A, B, C ou D à la suite indique la variante), modèle et couleur obligatoires.
 * Modification : le SKU ne change pas ; seuls les champs modifiés sont enregistrés.
 */
function ProductDrawer({ zone, initial, currencies, onClose }: { zone: Zone; initial?: CatalogItem; currencies: Currency[]; onClose: () => void }) {
  const { t } = useT()
  const toast = useToast()
  const isNew = !initial
  const defaultCurrency = zoneInfo(zone).defaultCurrency
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [material, setMaterial] = useState(initial?.material ?? '')
  const [color, setColor] = useState(initial?.color ?? '')
  const [season, setSeason] = useState(initial?.season ?? '')
  const [carryOver, setCarryOver] = useState(Boolean(initial?.carryOver))
  const [rule, setRule] = useState(initial?.maxDiscountPct === undefined ? '' : String(initial.maxDiscountPct)) // '' non contrôlé · '0' non soldé · pourcentage
  const [extra, setExtra] = useState<Record<string, string>>(Object.fromEntries(TEXT_FIELDS.map((k) => [k, initial?.[k] ?? ''])))
  const shownCurrencies = [...new Set([...(isNew ? [defaultCurrency] : []), ...currencies, ...Object.keys(initial?.rrp ?? {}), ...Object.keys(initial?.wholesale ?? {})])]
  const [more, setMore] = useState<Currency[]>([])
  const rows = [...shownCurrencies, ...more.filter((c) => !shownCurrencies.includes(c))]
  const [rrp, setRrp] = useState<Record<string, string>>(Object.fromEntries(rows.map((c) => [c, initial?.rrp[c] === undefined ? '' : String(initial.rrp[c])])))
  const [whs, setWhs] = useState<Record<string, string>>(Object.fromEntries(rows.map((c) => [c, initial?.wholesale[c] === undefined ? '' : String(initial.wholesale[c])])))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const cleanSku = sku.trim().toUpperCase()
  const skuError = isNew && !/^[A-Z0-9]{9}[A-Z]?$/.test(cleanSku) ? t('err.sku') : ''
  const modelError = !model.trim() ? t('err.model') : ''
  const colorError = !color.trim() ? t('err.color') : ''
  const hasError = Boolean(skuError || modelError || colorError)
  const num = (v: string): number | undefined => {
    const n = Number(v.replace(',', '.'))
    return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined
  }
  const steps = [...new Set([...RULE_STEPS, ...(Number(rule) > 0 ? [Number(rule)] : [])])].sort((a, b) => a - b)
  const setCarry = (on: boolean) => {
    setCarryOver(on)
    // Un carry-over n'est pas soldé : la règle suit, sauf si elle a été réglée à la main.
    if (on && rule === '') setRule('0')
    if (!on && rule === '0') setRule('')
  }

  const save = async () => {
    setTouched(true)
    if (hasError || busy) return
    setBusy(true)
    try {
      const rrpMap = Object.fromEntries(rows.map((c) => [c, num(rrp[c] ?? '')]))
      const whsMap = Object.fromEntries(rows.map((c) => [c, num(whs[c] ?? '')]))
      const maxDiscountPct = rule === '' ? undefined : Number(rule)
      if (isNew) {
        const letter = cleanSku.length === 10 ? [cleanSku[9]] : []
        await api.addProduct(zone, {
          sku: cleanSku.slice(0, 9),
          variants: letter,
          model: model.trim(),
          material: material.trim(),
          color: color.trim(),
          dept: extra.dept.trim(),
          season: season.trim().toUpperCase(),
          carryOver: carryOver || undefined,
          maxDiscountPct,
          rrp: Object.fromEntries(Object.entries(rrpMap).filter(([, v]) => v !== undefined)) as Record<string, number>,
          wholesale: Object.fromEntries(Object.entries(whsMap).filter(([, v]) => v !== undefined)) as Record<string, number>,
          ...Object.fromEntries(TEXT_FIELDS.filter((k) => k !== 'dept' && extra[k].trim()).map((k) => [k, extra[k].trim()])),
        })
        toast.show(t('toast.productAdded'))
      } else {
        const patch: Parameters<typeof api.updateProduct>[2] = {}
        if (model.trim() !== initial.model) patch.model = model.trim()
        if (material.trim() !== initial.material) patch.material = material.trim()
        if (color.trim() !== initial.color) patch.color = color.trim()
        if (season.trim().toUpperCase() !== initial.season) patch.season = season.trim().toUpperCase()
        if (carryOver !== Boolean(initial.carryOver)) patch.carryOver = carryOver || undefined
        if (maxDiscountPct !== initial.maxDiscountPct) patch.maxDiscountPct = maxDiscountPct
        for (const k of TEXT_FIELDS) if (extra[k].trim() !== (initial[k] ?? '')) patch[k] = extra[k].trim()
        const rrpPatch = Object.fromEntries(rows.filter((c) => rrpMap[c] !== initial.rrp[c]).map((c) => [c, rrpMap[c]]))
        const whsPatch = Object.fromEntries(rows.filter((c) => whsMap[c] !== initial.wholesale[c]).map((c) => [c, whsMap[c]]))
        if (Object.keys(rrpPatch).length) patch.rrp = rrpPatch as Record<string, number>
        if (Object.keys(whsPatch).length) patch.wholesale = whsPatch as Record<string, number>
        if (Object.keys(patch).length) await api.updateProduct(zone, initial.sku, patch)
        toast.show(t('sProducts.saved'))
      }
      refresh()
      onClose()
    } catch (e) {
      toast.show(e instanceof Error && e.message.includes('sku-exists') ? t('err.skuExists') : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const text = (id: string, label: string, value: string, set: (v: string) => void, error = '', props: { autoFocus?: boolean; placeholder?: string } = {}) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" value={value} onChange={(e) => set(e.target.value)} aria-invalid={touched && Boolean(error)} {...props} />
      {touched && error && <span className="error-text">{error}</span>}
    </div>
  )

  return (
    <Drawer
      title={isNew ? t('drawer.newProduct') : `${initial.model} ${initial.color}`}
      subtitle={isNew ? undefined : t('label.sku', { value: initial.sku })}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {t('common.save')}
          </button>
        </>
      }
    >
      {isNew && (
        <div className="field">
          <label htmlFor="p-sku">{t('col.sku')}</label>
          <input id="p-sku" className="input" value={sku} maxLength={10} onChange={(e) => setSku(e.target.value)} placeholder="CP0502429" aria-invalid={touched && Boolean(skuError)} autoFocus />
          <span className="small muted">{t('field.skuHint')}</span>
          {touched && skuError && <span className="error-text">{skuError}</span>}
        </div>
      )}
      <div className="form-grid">
        {text('p-model', t('col.model'), model, setModel, modelError)}
        {text('p-color', t('col.color'), color, setColor, colorError)}
        {text('p-material', t('col.material'), material, setMaterial)}
        {text('p-season', t('col.season'), season, setSeason, '', { placeholder: 'AW26' })}
      </div>
      <label className="field check-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={carryOver} onChange={(e) => setCarry(e.target.checked)} />
        <b>{t('col.carryOver')}</b>
      </label>
      <div className="field">
        <label htmlFor="p-rule">{t('col.rule')}</label>
        <select id="p-rule" className="select" value={rule} onChange={(e) => setRule(e.target.value)}>
          <option value="">{t('rule.unset')}</option>
          <option value="0">{t('rule.none')}</option>
          {steps.map((n) => (
            <option key={n} value={String(n)}>
              {n} %
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="label">{t('sProducts.prices')}</span>
        <div className="stack-sm">
          {rows.map((cur) => (
            <div key={cur} className="price-row">
              <b>{cur}</b>
              <input className="input num" inputMode="decimal" aria-label={`RRP ${cur}`} placeholder="RRP" value={rrp[cur] ?? ''} onChange={(e) => setRrp((r) => ({ ...r, [cur]: e.target.value }))} />
              <input className="input num" inputMode="decimal" aria-label={`${t('col.wholesaleShort')} ${cur}`} placeholder={t('col.wholesaleShort')} value={whs[cur] ?? ''} onChange={(e) => setWhs((r) => ({ ...r, [cur]: e.target.value }))} />
            </div>
          ))}
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="small muted">{t('sProducts.addCurrency')}</span>
            <CurrencySelect ariaLabel={t('sProducts.addCurrency')} value="" onChange={(c) => c && setMore((m) => [...m, c])} />
          </div>
        </div>
      </div>
      <details className="field">
        <summary className="label" style={{ cursor: 'pointer' }}>{t('sProducts.details')}</summary>
        <div className="form-grid" style={{ marginTop: 8 }}>
          {TEXT_FIELDS.map((k) => text(`p-${k}`, t(`col.${k}` as const), extra[k], (v) => setExtra((e) => ({ ...e, [k]: v })), ''))}
        </div>
      </details>
    </Drawer>
  )
}
