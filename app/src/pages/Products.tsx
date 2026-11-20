import { SeasonFilter } from '../components/SeasonFilter'
import { useState } from 'react'
import { api } from '../api'
import { DataGrid, type GridColumn } from '../components/DataGrid'
import { Card, DiscountPill, Empty, ErrorBlock, KpiCard, LoadingBlock, PageHeader, Pill, ProductImage } from '../components/ui'
import { WeekPicker } from '../components/WeekPicker'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatDiscount, formatMoney } from '../lib/format'
import { useT } from '../lib/i18n'
import { link, navigate, useRoute } from '../lib/router'
import type { ProductRow } from '../types'

const DEFAULT_COLS = ['sku', 'season', 'accounts', 'lowest', 'rrp', 'maxDiscount', 'anomalies']

/**
 * Suivi des produits : pour chacun, chez combien de comptes il est vendu, le pire prix et les anomalies.
 * Toutes les colonnes se trient et se filtrent ; les colonnes affichées se choisissent.
 */
export function Products() {
  const { t } = useT()
  const { zone } = useZone()
  const { params } = useRoute()
  const weekParam = params.get('week') ?? undefined
  const overview = useQuery(() => api.getWeek(zone, weekParam), [zone, weekParam])
  const products = useQuery(() => api.listProducts(zone, weekParam), [zone, weekParam])
  const [onlyAnomaly, setOnlyAnomaly] = useState(params.get('filter') === 'anomaly') // l'indicateur du tableau de bord ouvre la liste déjà filtrée

  if (products.error) return <div className="page"><ErrorBlock message={products.error} onRetry={refresh} /></div>
  if (!products.data || !overview.data) return <div className="page"><LoadingBlock /></div>

  const o = overview.data
  const goWeek = (w: string) => navigate(link('/produits', { week: w !== o.weeks[0] ? w : undefined }))
  const detail = (sku: string) => `/produits/${encodeURIComponent(sku)}${weekParam ? `?week=${weekParam}` : ''}`
  const all = products.data
  const rows = all.filter((p) => !onlyAnomaly || p.anomalies > 0)

  const columns: GridColumn<ProductRow>[] = [
    {
      key: 'product',
      label: t('col.product'),
      fixed: true,
      get: (p) => `${p.item.model} ${p.item.material} ${p.item.color} ${p.sku}`,
      render: (p) => (
        <a className="cell-account" href={`#${detail(p.sku)}`}>
          <ProductImage src={p.item.image} sku={p.sku} color={p.item.color} label={p.item.model} size={44} />
          <span>
            <b>
              {p.item.model} {p.item.color}
            </b>
            <small>{t('label.sku', { value: p.sku })}</small>
          </span>
        </a>
      ),
    },
    { key: 'sku', label: t('col.sku'), get: (p) => p.sku, render: (p) => <span className="muted">{p.sku}</span> },
    { key: 'model', label: t('col.model'), get: (p) => p.item.model, choice: true },
    { key: 'material', label: t('col.material'), get: (p) => p.item.material, choice: true },
    { key: 'color', label: t('col.color'), get: (p) => p.item.color },
    { key: 'dept', label: t('col.dept'), get: (p) => p.item.dept || null, choice: true },
    { key: 'segmentation', label: t('col.segmentation'), get: (p) => p.item.segmentation ?? null, choice: true },
    { key: 'season', label: t('col.season'), get: (p) => p.item.season || null, choice: true },
    { key: 'carryOver', label: t('col.carryOver'), get: (p) => (p.item.carryOver ? t('pill.carryOver') : '—'), choice: true },
    { key: 'rule', label: t('col.rule'), get: (p) => (p.item.maxDiscountPct === undefined ? null : p.item.maxDiscountPct), numeric: true, render: (p) => (p.item.maxDiscountPct === undefined ? <span className="muted">{t('rule.unset')}</span> : p.item.maxDiscountPct === 0 ? t('rule.none') : `${p.item.maxDiscountPct} %`) },
    { key: 'accounts', label: t('col.accounts'), get: (p) => p.accounts, numeric: true },
    { key: 'lowest', label: t('col.lowest'), get: (p) => p.lowest, numeric: true, render: (p) => <span className={`strong ${p.anomalies > 0 ? 'danger' : ''}`}>{formatMoney(p.lowest, p.currency)}</span> },
    { key: 'rrp', label: t('col.reference'), get: (p) => p.rrp, numeric: true, render: (p) => <span className="muted">{formatMoney(p.rrp, p.currency)}</span> },
    { key: 'currency', label: t('col.currency'), get: (p) => p.currency, choice: true },
    { key: 'maxDiscount', label: t('col.maxDiscount'), get: (p) => p.worstDiscountPct, numeric: true, render: (p) => <DiscountPill pct={p.worstDiscountPct} anomaly={p.anomalies > 0} /> },
    {
      key: 'anomalies',
      label: t('col.anomalies'),
      get: (p) => p.anomalies,
      numeric: true,
      render: (p) =>
        p.anomalies > 0 ? (
          <span className="count-cell">
            <b>{p.anomalies}</b>
            {p.toReview > 0 && <Pill tone="warn">{t('pill.toReview', { n: p.toReview })}</Pill>}
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ]

  return (
    <div className="page">
      <PageHeader title={t('products.title')} actions={
          <>
            <SeasonFilter />
            <WeekPicker stats={o.weekStats} value={o.weekOf} onChange={goWeek} />
          </>
        }
      />

      {all.length === 0 ? (
        <Empty title={t('products.empty')} />
      ) : (
        <>
          {(() => {
            const flagged = all.filter((p) => p.anomalies > 0)
            const toReview = all.reduce((s, p) => s + p.toReview, 0)
            const worst = all.reduce<ProductRow | null>((m, p) => (p.anomalies > 0 && (!m || p.worstDiscountPct > m.worstDiscountPct) ? p : m), null)
            return (
              <div className="grid-kpi">
                <KpiCard icon="alert" tone={flagged.length > 0 ? 'danger' : 'ok'} label={t('kpi.anomalies')} value={flagged.length} hint={t('kpi.outOfProducts', { total: all.length })} />
                <KpiCard icon="checkCircle" tone="ok" label={t('kpi.compliantProducts')} value={all.length - flagged.length} hint={t('kpi.outOfProducts', { total: all.length })} />
                <KpiCard icon="help" tone={toReview > 0 ? 'warn' : 'ok'} label={t('kpi.toReview')} value={toReview} href="#/identifier" />
                <KpiCard icon="arrowDown" tone={worst ? 'danger' : 'ok'} label={t('kpi.topDiscount')} value={worst ? formatDiscount(worst.worstDiscountPct) : '—'} hint={worst ? `${worst.item.model} ${worst.item.color}` : undefined} href={worst ? `#${detail(worst.sku)}` : undefined} />
              </div>
            )
          })()}
          <Card flush>
            <DataGrid
              rows={rows}
              columns={columns}
              rowKey={(p) => p.sku}
              storageKey="pm.productsCols"
              defaultKeys={DEFAULT_COLS}
              toolbar={
                <>
                  <div className="seg" role="group">
                    <button aria-pressed={!onlyAnomaly} onClick={() => setOnlyAnomaly(false)}>
                      {t('filter.all')}
                    </button>
                    <button aria-pressed={onlyAnomaly} onClick={() => setOnlyAnomaly(true)}>
                      {t('filter.anomaly')}
                    </button>
                  </div>
                </>
              }
              onRowClick={(p) => navigate(detail(p.sku))}
              rowClassName={(p) => (p.anomalies > 0 ? 's-anomaly' : '')}
              emptyText={t('products.noMatch')}
            />
          </Card>
        </>
      )}
    </div>
  )
}
