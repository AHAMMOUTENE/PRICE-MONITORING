import { useState } from 'react'
import { api } from '../api'
import { BarChart, MiniBars } from '../components/charts'
import { ExportMenu } from '../components/ExportMenu'
import { SeeMore } from '../components/SeeMore'
import { AccountLogo, Card, CommentCell, DiscountPill, Empty, ErrorBlock, KpiCard, LoadingBlock, PageHeader, ProductImage } from '../components/ui'
import { LastScan } from '../components/ScanButton'
import { SeasonFilter } from '../components/SeasonFilter'
import { WeekPicker } from '../components/WeekPicker'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatDiscount, formatMoney, formatShortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { link, navigate, useRoute } from '../lib/router'
import { sortBy, SortHead, SortTh, useSort } from '../lib/sort'

const TOP_STEP = 5
const HANDLE_STEP = 6

/** Tableau de bord, de haut en bas : les produits les plus remisés, les indicateurs, les comptes à traiter, puis la tendance. */
export function Dashboard() {
  const { t } = useT()
  const { zone } = useZone()
  const { params } = useRoute()
  const weekParam = params.get('week') ?? undefined
  const overview = useQuery(() => api.getWeek(zone, weekParam), [zone, weekParam])
  const anomalies = useQuery(() => api.listAnomalies(zone, weekParam ?? ''), [zone, weekParam])
  const [limitTop, setLimitTop] = useState(TOP_STEP)
  const [limitHandle, setLimitHandle] = useState(HANDLE_STEP)
  const topSort = useSort()
  const handleSort = useSort()
  const o = overview.data

  if (overview.error) return <div className="page"><ErrorBlock message={overview.error} onRetry={refresh} /></div>
  if (!o) return <div className="page"><LoadingBlock /></div>

  const goWeek = (w: string) => navigate(link('/', { week: w !== o.weeks[0] ? w : undefined }))
  const withWeek = (path: string) => link(path, { week: weekParam }) // `link` renvoie déjà le « # »
  const scannable = o.retailers.filter((r) => r.status !== 'no-site' && r.status !== 'excluded').length
  // Nouvelles cette semaine : en anomalie à ce scan, mais pas au précédent.
  const fresh = (anomalies.data ?? []).filter((a) => a.proof === 'confirmed' && a.consecutiveChecks === 1).length
  const delta = o.deltaConfirmed
  const top = (anomalies.data ?? []).filter((a) => a.proof === 'confirmed').sort((a, b) => b.discountPct - a.discountPct)
  const topSorted = sortBy(top, topSort.sort, {
    product: (a) => a.title,
    sitePrice: (a) => a.salePrice,
    reference: (a) => a.rrp,
    discount: (a) => a.discountPct,
  })
  const toHandle = sortBy(
    o.retailers.filter((r) => r.status === 'anomaly'),
    handleSort.sort,
    {
      account: (r) => r.retailer.name,
      anomalies: (r) => r.confirmed + r.toReview,
      maxDiscount: (r) => r.worstDiscountPct,
      comment: (r) => r.lastComment?.at ?? null,
      trend: (r) => r.trend.reduce((a, b) => a + b, 0),
    },
  )

  return (
    <div className="page">
      <PageHeader
        title={t('dash.title')}
        subtitle={import.meta.env.VITE_API_URL ? undefined : t('app.demo')}
        actions={
          <>
            <LastScan lastScan={o.lastScan} />
            <SeasonFilter />
            <WeekPicker stats={o.weekStats} value={o.weekOf} onChange={goWeek} />
            <span data-tour="export">
              <ExportMenu weekOf={o.weekOf} weeks={o.weeks} />
            </span>
          </>
        }
      />

      <div className="stack">
        <div data-tour="dash-top">
        <Card title={t('dash.topDiscounted')} flush>
          {top.length === 0 ? (
            <p className="card-empty">{t('dash.noAnomaly')}</p>
          ) : (
            <>
              <div className="prow prow-head">
                <span />
                <SortHead col="product" label={t('col.product')} sort={topSort.sort} onSort={topSort.toggle} />
                <SortHead col="sitePrice" label={t('label.sitePrice')} sort={topSort.sort} onSort={topSort.toggle} numeric />
                <SortHead col="reference" label={t('col.reference')} sort={topSort.sort} onSort={topSort.toggle} numeric />
                <SortHead col="discount" label={t('col.discount')} sort={topSort.sort} onSort={topSort.toggle} numeric />
              </div>
              {topSorted.slice(0, limitTop).map((a) => (
                <a key={a.id} className="prow" href={a.sku ? `#/produits/${encodeURIComponent(a.sku)}` : `#/comptes/${encodeURIComponent(a.retailerId)}`}>
                  <ProductImage src={a.image} sku={a.sku} color={a.color} label={a.title} size={44} />
                  <span className="prow-text">
                    <b>{a.title}</b>
                    <span>{t('label.account', { name: a.retailerName })}</span>
                  </span>
                  <span className="prow-price danger">{formatMoney(a.salePrice, a.currency)}</span>
                  <span className="prow-ref">{formatMoney(a.rrp, a.currency)}</span>
                  <DiscountPill pct={a.discountPct} />
                </a>
              ))}
              <SeeMore total={top.length} limit={limitTop} step={TOP_STEP} onMore={() => setLimitTop((n) => n + TOP_STEP)} allHref={withWeek('/produits')} />
            </>
          )}
        </Card>
        </div>

        <div className="grid-kpi">
          <KpiCard
            icon="alert"
            tone={o.confirmed > 0 ? 'danger' : 'ok'}
            label={t('kpi.anomalies')}
            value={o.confirmed}
            hint={delta === null ? undefined : delta === 0 ? t('kpi.stable') : t('kpi.vsPrev', { delta: `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` })}
            href={link('/produits', { week: weekParam, filter: 'anomaly' })}
          />
          <KpiCard icon="arrowUp" tone={fresh > 0 ? 'danger' : 'ok'} label={t('kpi.new')} value={fresh} href={link('/produits', { week: weekParam, filter: 'anomaly' })} />
          <KpiCard icon="help" tone={o.toReview > 0 ? 'warn' : 'ok'} label={t('kpi.toReview')} value={o.toReview} hint={o.toReview > 0 ? t('match.start') : undefined} href="#/identifier" />
          <KpiCard icon="store" label={t('kpi.accounts')} value={o.retailersInAnomaly} hint={t('kpi.outOf', { total: scannable })} href={link('/comptes', { week: weekParam, filter: 'anomaly' })} />
        </div>

        <Card title={t('dash.toHandle')} flush>
          {toHandle.length === 0 ? (
            <Empty title={t('dash.noAnomaly')} />
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <SortTh col="account" label={t('col.account')} sort={handleSort.sort} onSort={handleSort.toggle} />
                    <SortTh col="anomalies" label={t('col.anomalies')} sort={handleSort.sort} onSort={handleSort.toggle} numeric className="num" />
                    <SortTh col="maxDiscount" label={t('col.maxDiscount')} sort={handleSort.sort} onSort={handleSort.toggle} numeric className="num" />
                    <SortTh col="comment" label={t('col.comment')} sort={handleSort.sort} onSort={handleSort.toggle} />
                    <SortTh col="trend" label={t('col.trend')} sort={handleSort.sort} onSort={handleSort.toggle} numeric />
                  </tr>
                </thead>
                <tbody>
                  {toHandle.slice(0, limitHandle).map((r) => (
                    <tr key={r.retailer.id} className="is-clickable" onClick={() => navigate(`/comptes/${encodeURIComponent(r.retailer.id)}`)}>
                      <td>
                        <a className="cell-account" href={`#/comptes/${encodeURIComponent(r.retailer.id)}`}>
                          <AccountLogo name={r.retailer.name} size={32} />
                          <b>{r.retailer.name}</b>
                        </a>
                      </td>
                      <td className="num strong">{r.confirmed + r.toReview}</td>
                      <td className="num danger strong">{formatDiscount(r.worstDiscountPct)}</td>
                      <td>
                        <CommentCell comment={r.lastComment} />
                      </td>
                      <td>
                        <MiniBars values={r.trend} label={t('col.trend')} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <SeeMore total={toHandle.length} limit={limitHandle} step={HANDLE_STEP} onMore={() => setLimitHandle((n) => n + HANDLE_STEP)} allHref={withWeek('/comptes')} />
            </>
          )}
        </Card>

        <Card title={t('chart.anomaliesByWeek')}>
          <BarChart
            ariaLabel={t('chart.anomaliesByWeek')}
            data={[...o.weekStats].reverse().map((s) => ({ key: s.week, label: formatShortDate(s.week), value: s.confirmed }))}
            selected={o.weekOf}
            onSelect={goWeek}
          />
        </Card>
      </div>
    </div>
  )
}
