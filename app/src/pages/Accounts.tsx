import { useState } from 'react'
import { api } from '../api'
import { MiniBars } from '../components/charts'
import { Icon } from '../components/Icon'
import { SeeMore } from '../components/SeeMore'
import { AccountLogo, Card, CommentCell, Empty, ErrorBlock, KpiCard, LoadingBlock, PageHeader, Pill } from '../components/ui'
import { ExportMenu } from '../components/ExportMenu'
import { distinct, FilterSelect } from '../components/FilterSelect'
import { SeasonFilter } from '../components/SeasonFilter'
import { WeekPicker } from '../components/WeekPicker'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatDiscount } from '../lib/format'
import { useT } from '../lib/i18n'
import { link, navigate, useRoute } from '../lib/router'
import { matchNumber } from '../lib/grid'
import { sortBy, SortTh, useSort } from '../lib/sort'

type Filter = 'all' | 'anomaly'

export function Accounts() {
  const { t } = useT()
  const { zone } = useZone()
  const { params } = useRoute()
  const weekParam = params.get('week') ?? undefined
  const overview = useQuery(() => api.getWeek(zone, weekParam), [zone, weekParam])
  const [q, setQ] = useState('')
  // Les indicateurs du tableau de bord ouvrent la liste déjà filtrée (?filter=anomaly).
  const [filter, setFilter] = useState<Filter>(params.get('filter') === 'anomaly' ? 'anomaly' : 'all')
  const [seg, setSeg] = useState('')
  const [rep, setRep] = useState('')
  const [fAnom, setFAnom] = useState('')
  const [fDisc, setFDisc] = useState('')
  const [fComment, setFComment] = useState('')
  const [fTrend, setFTrend] = useState('')
  const [limit, setLimit] = useState(15)
  const { sort, toggle } = useSort()
  const o = overview.data

  if (overview.error) return <div className="page"><ErrorBlock message={overview.error} onRetry={refresh} /></div>
  if (!o) return <div className="page"><LoadingBlock /></div>

  const goWeek = (w: string) => navigate(link('/comptes', { week: w !== o.weeks[0] ? w : undefined }))
  const segOptions = distinct(o.retailers.map((r) => r.retailer.segmentation))
  const repOptions = distinct(o.retailers.flatMap((r) => r.retailer.salesReps))
  const hasFilter = Boolean(q || seg || rep || fAnom || fDisc || fComment || fTrend)
  const resetFilters = () => {
    setQ('')
    setSeg('')
    setRep('')
    setFAnom('')
    setFDisc('')
    setFComment('')
    setFTrend('')
  }
  const anomaliesOf = (r: (typeof o.retailers)[number]) => (r.status === 'anomaly' ? r.confirmed + r.toReview : r.status === 'ok' ? 0 : null)
  const rows = o.retailers.filter(
    (r) =>
      (filter === 'all' || r.status === 'anomaly') &&
      (!seg || r.retailer.segmentation === seg) &&
      (!rep || r.retailer.salesReps.includes(rep)) &&
      (!q || `${r.retailer.name} ${r.retailer.segmentation}`.toLowerCase().includes(q.trim().toLowerCase())) &&
      matchNumber(anomaliesOf(r), fAnom) &&
      matchNumber(r.status === 'anomaly' ? r.worstDiscountPct : null, fDisc) &&
      (!fComment || (r.lastComment?.text ?? '').toLowerCase().includes(fComment.toLowerCase())) &&
      matchNumber(r.trend.reduce((a, b) => a + b, 0), fTrend),
  )
  const sorted = sortBy(rows, sort, {
    account: (r) => r.retailer.name,
    rep: (r) => r.retailer.salesReps.join(', ') || null,
    anomalies: (r) => (r.status === 'anomaly' ? r.confirmed + r.toReview : r.status === 'ok' ? 0 : null),
    maxDiscount: (r) => (r.status === 'anomaly' ? r.worstDiscountPct : null),
    comment: (r) => r.lastComment?.at ?? null,
    trend: (r) => r.trend.reduce((a, b) => a + b, 0),
  })
  const detail = (id: string) => `/comptes/${encodeURIComponent(id)}${weekParam ? `?week=${weekParam}` : ''}`

  return (
    <div className="page">
      <PageHeader
        title={t('accounts.title')}
        actions={
          <>
            <SeasonFilter />
            <WeekPicker stats={o.weekStats} value={o.weekOf} onChange={goWeek} />
            <ExportMenu weekOf={o.weekOf} weeks={o.weeks} />
          </>
        }
      />

      {o.retailers.length === 0 ? (
        <Empty
          title={t('accounts.empty')}
          action={
            <a className="btn btn-primary" href="#/reglages/comptes">
              <Icon name="plus" /> {t('accounts.addAccounts')}
            </a>
          }
        />
      ) : (
        <>
          {(() => {
            const scannable = o.retailers.filter((r) => r.status !== 'no-site' && r.status !== 'excluded')
            const inAnomaly = scannable.filter((r) => r.status === 'anomaly').length
            const noSite = o.retailers.filter((r) => r.status === 'no-site').length
            return (
              <div className="grid-kpi">
                <KpiCard icon="store" tone={inAnomaly > 0 ? 'danger' : 'ok'} label={t('kpi.accounts')} value={inAnomaly} hint={t('kpi.outOf', { total: scannable.length })} />
                <KpiCard icon="checkCircle" tone="ok" label={t('kpi.compliantAccounts')} value={scannable.length - inAnomaly} hint={t('kpi.outOf', { total: scannable.length })} />
                <KpiCard icon="help" tone={o.toReview > 0 ? 'warn' : 'ok'} label={t('kpi.toReview')} value={o.toReview} href="#/identifier" />
                <KpiCard icon="globe" tone={noSite > 0 ? 'warn' : 'ok'} label={t('kpi.noSite')} value={noSite} href="#/reglages/comptes" />
              </div>
            )
          })()}
          <div className="toolbar">
            <div className="seg" role="group">
              {(
                [
                  ['all', 'filter.all'],
                  ['anomaly', 'filter.anomaly'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>
                  {t(label)}
                </button>
              ))}
            </div>
            <FilterSelect label="col.segmentation" allLabel="filter.allSegmentations" value={seg} options={segOptions} onChange={setSeg} />
            {hasFilter && (
              <span className="filter-count">
                {t('filter.showing', { shown: rows.length, total: o.retailers.length })}
                <button className="linkbtn linkbtn-inline" onClick={resetFilters}>
                  {t('filter.reset')}
                </button>
              </span>
            )}
          </div>

          <div data-tour="accounts-table">
          <Card flush>
            {rows.length === 0 ? (
              <p className="card-empty">{t('accounts.noMatch')}</p>
            ) : (
              <table className="table table-rows">
                <thead>
                  <tr className="head-titles">
                    <SortTh col="account" label={t('col.account')} sort={sort} onSort={toggle} />
                    <SortTh col="rep" label={t('col.rep')} sort={sort} onSort={toggle} />
                    <SortTh col="anomalies" label={t('col.anomalies')} sort={sort} onSort={toggle} numeric />
                    <SortTh col="maxDiscount" label={t('col.maxDiscount')} sort={sort} onSort={toggle} numeric className="num" />
                    <SortTh col="comment" label={t('col.comment')} sort={sort} onSort={toggle} />
                    <SortTh col="trend" label={t('col.trend')} sort={sort} onSort={toggle} numeric />
                    <th scope="col" />
                  </tr>
                  <tr className="filter-row">
                    <th scope="col">
                      <input className="cell-filter" type="search" aria-label={t('accounts.search')} placeholder={t('accounts.search')} value={q} onChange={(e) => setQ(e.target.value)} />
                    </th>
                    <th scope="col">
                      <select className="cell-filter" aria-label={t('col.rep')} value={rep} onChange={(e) => setRep(e.target.value)}>
                        <option value="">{t('filter.allReps')}</option>
                        {repOptions.map((o2) => (
                          <option key={o2.value} value={o2.value}>
                            {o2.label}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th scope="col">
                      <input className="cell-filter num" type="search" aria-label={t('col.anomalies')} placeholder={t('filter.numPlaceholder')} title={t('filter.numHint')} value={fAnom} onChange={(e) => setFAnom(e.target.value)} />
                    </th>
                    <th scope="col">
                      <input className="cell-filter num" type="search" aria-label={t('col.maxDiscount')} placeholder={t('filter.numPlaceholder')} title={t('filter.numHint')} value={fDisc} onChange={(e) => setFDisc(e.target.value)} />
                    </th>
                    <th scope="col">
                      <input className="cell-filter" type="search" aria-label={t('col.comment')} placeholder={t('filter.textPlaceholder')} value={fComment} onChange={(e) => setFComment(e.target.value)} />
                    </th>
                    <th scope="col">
                      <input className="cell-filter num" type="search" aria-label={t('col.trend')} placeholder={t('filter.numPlaceholder')} title={t('filter.numHint')} value={fTrend} onChange={(e) => setFTrend(e.target.value)} />
                    </th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, limit).map((r) => (
                    <tr key={r.retailer.id} className={`is-clickable s-${r.status === 'anomaly' ? (r.confirmed === 0 ? 'review' : 'anomaly') : r.status}`} onClick={() => navigate(detail(r.retailer.id))}>
                      <td>
                        <a className="cell-account" href={`#${detail(r.retailer.id)}`}>
                          <AccountLogo name={r.retailer.name} size={36} />
                          <span>
                            <b>{r.retailer.name}</b>
                            {r.retailer.segmentation && <small>{t('label.segmentation', { value: r.retailer.segmentation })}</small>}
                          </span>
                        </a>
                      </td>
                      <td className="muted">{r.retailer.salesReps.join(', ') || '—'}</td>
                      <td>
                        {r.status === 'anomaly' ? (
                          <span className="count-cell">
                            <b>{r.confirmed + r.toReview}</b>
                            {r.toReview > 0 && <Pill tone="warn">{t('pill.toReview', { n: r.toReview })}</Pill>}
                          </span>
                        ) : r.status === 'no-site' ? (
                          <Pill tone="neutral">{t('pill.siteMissing')}</Pill>
                        ) : r.status === 'excluded' ? (
                          <Pill tone="neutral" icon="ban">
                            {t('status.excluded')}
                          </Pill>
                        ) : (
                          <Pill tone="ok" icon="check">
                            {t('status.ok')}
                          </Pill>
                        )}
                      </td>
                      <td className="num danger strong">{r.status === 'anomaly' ? formatDiscount(r.worstDiscountPct) : ''}</td>
                      <td>
                        <CommentCell comment={r.lastComment} />
                      </td>
                      <td>
                        <MiniBars values={r.trend} label={t('col.trend')} />
                      </td>
                      <td className="num">
                        <Icon name="chevronRight" className="icon muted" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <SeeMore total={rows.length} limit={limit} step={15} onMore={() => setLimit((n) => n + 15)} />
          </Card>
          </div>
        </>
      )}
    </div>
  )
}
