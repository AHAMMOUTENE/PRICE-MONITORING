import { useState, type ReactNode } from 'react'
import { HScroll } from './HScroll'
import { Icon } from './Icon'
import { SeeMore } from './SeeMore'
import { matchNumber, readColumns, writeColumns } from '../lib/grid'
import { useT } from '../lib/i18n'
import { sortBy, SortTh, useSort } from '../lib/sort'

export interface GridColumn<T> {
  key: string
  label: string
  /** Valeur de la cellule, pour le tri, le filtre et les listes de choix. */
  get: (row: T) => string | number | null
  /** Rendu de la cellule ; sinon la valeur telle quelle. */
  render?: (row: T) => ReactNode
  numeric?: boolean
  /** Filtre par liste de valeurs plutôt que par texte libre. */
  choice?: boolean
  /** Toujours affichée, impossible à retirer (la colonne qui identifie la ligne). */
  fixed?: boolean
}

/**
 * Tableau de données générique : tri sur chaque colonne, ligne de filtres sous l'en-tête
 * (texte contenu, liste de valeurs, ou borne pour les nombres), choix des colonnes mémorisé, « Voir plus ».
 */
export function DataGrid<T>({
  rows,
  columns,
  rowKey,
  storageKey,
  defaultKeys,
  onRowClick,
  rowClassName,
  emptyText,
  step = 15,
  className = '',
  toolbar,
}: {
  rows: T[]
  columns: GridColumn<T>[]
  rowKey: (row: T) => string
  storageKey: string
  defaultKeys?: string[]
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  emptyText: string
  step?: number
  className?: string
  /** Recherche, boutons… affichés à gauche de la barre du tableau. */
  toolbar?: ReactNode
}) {
  const { t } = useT()
  const { sort, toggle } = useSort()
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [limit, setLimit] = useState(step)
  const [chosen, setChosen] = useState<string[] | null>(() => readColumns(storageKey))

  const all = columns.map((c) => c.key)
  const shownKeys = (chosen ?? defaultKeys ?? all).filter((k) => all.includes(k))
  const shown = columns.filter((c) => c.fixed || shownKeys.includes(c.key))
  const setCols = (keys: string[]) => {
    setChosen(keys)
    writeColumns(storageKey, keys)
  }
  const active = Object.entries(filters).filter(([, v]) => v)
  const filtered = rows.filter((r) =>
    active.every(([k, v]) => {
      const c = columns.find((x) => x.key === k)
      if (!c) return true
      const value = c.get(r)
      if (c.numeric) return matchNumber(typeof value === 'number' ? value : null, v)
      if (c.choice) return String(value ?? '') === v
      return String(value ?? '').toLowerCase().includes(v.toLowerCase())
    }),
  )
  const choices = (c: GridColumn<T>) => [...new Set(rows.map((r) => String(c.get(r) ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const sorted = sortBy(filtered, sort, Object.fromEntries(columns.map((c) => [c.key, c.get])))

  return (
    <div className={`grid-block ${className}`}>
      <div className="grid-bar">
        {toolbar}
        {active.length > 0 && (
          <span className="filter-count">
            {t('filter.showing', { shown: filtered.length, total: rows.length })}
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
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setCols(all)}>
                {t('sProducts.view.all')}
              </button>
              {defaultKeys && (
                <button className="btn btn-ghost btn-sm" onClick={() => setCols(defaultKeys)}>
                  {t('sProducts.view.essential')}
                </button>
              )}
            </div>
            <div className="colpick-list">
              {columns.map((c) => (
                <label key={c.key}>
                  <input type="checkbox" checked={c.fixed || shownKeys.includes(c.key)} disabled={c.fixed} onChange={(e) => setCols(e.target.checked ? all.filter((k) => k === c.key || shownKeys.includes(k)) : shownKeys.filter((k) => k !== c.key))} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        </details>
      </div>
      <HScroll>
        <table className="table table-rows table-grid">
          <thead>
            <tr className="head-titles">
              {shown.map((c) => (
                <SortTh key={c.key} col={c.key} label={c.label} sort={sort} onSort={toggle} numeric={c.numeric} className={c.numeric ? 'num' : undefined} />
              ))}
              {onRowClick && <th scope="col" />}
            </tr>
            <tr className="filter-row">
              {shown.map((c) => (
                <th key={c.key} scope="col">
                  {c.choice ? (
                    <select className="cell-filter" aria-label={c.label} value={filters[c.key] ?? ''} onChange={(e) => setFilters({ ...filters, [c.key]: e.target.value })}>
                      <option value="">{t('filter.all')}</option>
                      {choices(c).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={`cell-filter${c.numeric ? ' num' : ''}`}
                      type="search"
                      aria-label={c.label}
                      placeholder={c.numeric ? t('filter.numPlaceholder') : t('filter.textPlaceholder')}
                      title={c.numeric ? t('filter.numHint') : undefined}
                      value={filters[c.key] ?? ''}
                      onChange={(e) => setFilters({ ...filters, [c.key]: e.target.value })}
                    />
                  )}
                </th>
              ))}
              {onRowClick && <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={shown.length + (onRowClick ? 1 : 0)} className="card-empty">
                  {emptyText}
                </td>
              </tr>
            )}
            {sorted.slice(0, limit).map((r) => (
              <tr key={rowKey(r)} className={`${onRowClick ? 'is-clickable ' : ''}${rowClassName?.(r) ?? ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {shown.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>
                    {c.render ? c.render(r) : (c.get(r) ?? <span className="muted">—</span>)}
                  </td>
                ))}
                {onRowClick && (
                  <td className="num">
                    <Icon name="chevronRight" className="icon muted" />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </HScroll>
      <SeeMore total={sorted.length} limit={limit} step={step} onMore={() => setLimit((n) => n + step)} />
    </div>
  )
}
