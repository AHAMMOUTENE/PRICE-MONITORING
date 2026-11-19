import { useState } from 'react'
import { api } from '../../api'
import { HScroll } from '../../components/HScroll'
import { Icon } from '../../components/Icon'
import { ImportDrawer } from '../../components/ImportDrawer'
import { useToast } from '../../components/toast'
import { Card, Empty, ErrorBlock, LoadingBlock, PageHeader, ProductImage } from '../../components/ui'
import { refresh, useQuery, useZone } from '../../lib/app'
import { CURRENCIES } from '../../lib/currencies'
import { formatMoney } from '../../lib/format'
import { matchNumber } from '../../lib/grid'
import { useT } from '../../lib/i18n'
import { sortBy, SortTh, useSort } from '../../lib/sort'
import type { CatalogItem, Currency } from '../../types'

/** Remises proposées pour la règle d'un produit, en plus de « par défaut » et « non soldé ». */
const RULE_STEPS = [10, 15, 20, 25, 30, 40, 50]
const STORAGE = 'pm.catalogCols.v2'

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

function readCols(): ColKey[] | null {
  try {
    const raw = localStorage.getItem(STORAGE)
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
  const toast = useToast()
  const catalog = useQuery(() => api.listCatalog(zone), [zone])
  const zoneCurrencies = useQuery(() => api.listCurrencies(zone), [zone])
  const [importing, setImporting] = useState(false)
  const { sort, toggle } = useSort()
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [cols, setColsState] = useState<ColKey[] | null>(readCols)

  if (catalog.error) return <div className="page"><ErrorBlock message={catalog.error} onRetry={refresh} /></div>
  if (!catalog.data || !zoneCurrencies.data) return <div className="page"><LoadingBlock /></div>

  // Devises du catalogue : celles des sites de la zone d'abord, puis toutes celles qui ont un prix dans le fichier.
  const inCatalog = new Set<Currency>()
  for (const c of catalog.data) for (const cur of [...Object.keys(c.rrp), ...Object.keys(c.wholesale)]) inCatalog.add(cur)
  const currencies = [...zoneCurrencies.data, ...CURRENCIES.filter((c) => inCatalog.has(c) && !zoneCurrencies.data!.includes(c)), ...[...inCatalog].filter((c) => !CURRENCIES.includes(c) && !zoneCurrencies.data!.includes(c))]
  const allCols: ColKey[] = VIEWS.all(currencies)
  const shown: ColKey[] = (cols ?? VIEWS.all(currencies)).filter((k) => allCols.includes(k))
  const setCols = (next: ColKey[]) => {
    setColsState(next)
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next))
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

  const save = async (sku: string, patch: Parameters<typeof api.updateProduct>[2]) => {
    await api.updateProduct(zone, sku, patch)
    refresh()
    toast.show(t('sProducts.saved'))
  }
  const money = (c: CatalogItem, value: number | undefined, cur: string, label: string, apply: (v: number | undefined) => Parameters<typeof api.updateProduct>[2]) => (
    <TextCell value={value === undefined ? '' : String(value)} display={value === undefined ? '' : formatMoney(value, cur)} label={label} numeric onSave={(v) => save(c.sku, apply(v === '' ? undefined : Number(v.replace(',', '.'))))} />
  )

  return (
    <div className="page">
      <PageHeader
        title={t('sProducts.title')}
        subtitle={`${t('count.product', { n: catalog.data.length })} · ${t('sProducts.editHint')}`}
        actions={
          <button className="btn btn-primary" data-tour="import-catalog" onClick={() => setImporting(true)}>
            <Icon name="upload" /> {t('sProducts.import')}
          </button>
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
                <button key={v} aria-pressed={JSON.stringify(VIEWS[v](currencies)) === JSON.stringify(shown)} onClick={() => setCols(VIEWS[v](currencies))}>
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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={shown.length + 1}>
                    <Empty title={t('sProducts.noMatch')} />
                  </td>
                </tr>
              )}
              {rows.map((c) => (
                <tr key={c.sku}>
                  <td>
                    <span className="cell-account">
                      <ProductImage sku={c.sku} color={c.color} label={c.model} size={40} />
                      <span>
                        <b>{c.model}</b>
                        <small>{c.color}</small>
                      </span>
                    </span>
                  </td>
                  {shown.map((k) => {
                    if (k === 'sku') return <td key={k} className="muted">{c.sku}</td>
                    if (k === 'variants') return <td key={k} className="muted">{c.variants?.join(' · ') || '—'}</td>
                    if (k === 'carryOver')
                      return (
                        <td key={k}>
                          <label className="cell-check" title={t('label.carryOver')}>
                            <input
                              type="checkbox"
                              checked={Boolean(c.carryOver)}
                              aria-label={`${t('col.carryOver')} ${c.sku}`}
                              onChange={(e) => {
                                const on = e.target.checked
                                // Un carry-over n'est pas soldé : la règle suit, sauf si elle a été réglée à la main.
                                const patch: Parameters<typeof api.updateProduct>[2] = { carryOver: on || undefined }
                                if (on && c.maxDiscountPct === undefined) patch.maxDiscountPct = 0
                                if (!on && c.maxDiscountPct === 0) patch.maxDiscountPct = undefined
                                save(c.sku, patch)
                              }}
                            />
                            <span>{c.carryOver ? t('pill.carryOver') : '—'}</span>
                          </label>
                        </td>
                      )
                    if (k === 'rule') {
                      const own = c.maxDiscountPct
                      const steps = own !== undefined && own > 0 && !RULE_STEPS.includes(own) ? [...RULE_STEPS, own].sort((a, b) => a - b) : RULE_STEPS
                      return (
                        <td key={k}>
                          <select className={`cell-select rule-select${own === undefined ? ' is-default' : ''}`} aria-label={`${t('col.rule')} ${c.sku}`} value={own === undefined ? '' : String(own)} onChange={(e) => save(c.sku, { maxDiscountPct: e.target.value === '' ? undefined : Number(e.target.value) })}>
                            <option value="">{t('rule.unset')}</option>
                            <option value="0">{t('rule.none')}</option>
                            {steps.map((n) => (
                              <option key={n} value={String(n)}>
                                {n} %
                              </option>
                            ))}
                          </select>
                        </td>
                      )
                    }
                    if (k.startsWith('rrp:')) {
                      const cur = k.slice(4)
                      return <td key={k} className="num">{money(c, c.rrp[cur], cur, colLabel(k), (v) => ({ rrp: { [cur]: v } }))}</td>
                    }
                    if (k.startsWith('whs:')) {
                      const cur = k.slice(4)
                      return <td key={k} className="num">{money(c, c.wholesale[cur], cur, colLabel(k), (v) => ({ wholesale: { [cur]: v } }))}</td>
                    }
                    const key = k as TextCol
                    return (
                      <td key={k}>
                        <TextCell value={c[key] ?? ''} label={colLabel(k)} wide={key === 'description' || key === 'composition'} onSave={(v) => save(c.sku, { [key]: key === 'season' ? v.toUpperCase() : v })} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      </Card>

      {importing && (
        <ImportDrawer
          title={t('import.catalogTitle')}
          hint={t('import.catalogHint', { columns: ['SEASON', 'SEASONALITY', 'MAX DISCOUNT %', ...currencies.map((c) => `UNIT PRICE ${c}`), ...currencies.map((c) => `RRP ${c}`)].join(', ') })}
          template="catalog"
          onPreview={(f, o) => api.previewCatalogImport(f, zone, o)}
          onDone={(n) => toast.show(t('toast.imported', { n }))}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  )
}

/** Une cellule modifiable : le texte s'enregistre quand on quitte la cellule ou avec Entrée ; Échap annule. */
function TextCell({ value, display, label, numeric = false, wide = false, onSave }: { value: string; display?: string; label: string; numeric?: boolean; wide?: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const commit = () => {
    if (draft !== null && draft.trim() !== value) onSave(draft.trim())
    setDraft(null)
    setEditing(false)
  }
  return (
    <input
      className={`cell-input${numeric ? ' num' : ''}${wide ? ' wide' : ''}`}
      aria-label={label}
      title={wide ? value : undefined}
      inputMode={numeric ? 'decimal' : undefined}
      value={draft ?? (editing ? value : (display ?? value))}
      placeholder="—"
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}
