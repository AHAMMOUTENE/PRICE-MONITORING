import { useState } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { SeeMore } from '../components/SeeMore'
import { AccountLogo, Card, DiscountPill, Drawer, Empty, ErrorBlock, KpiCard, LoadingBlock, PageHeader, Pill, ProductImage } from '../components/ui'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatDiscount, formatMoney, formatShortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { navigate } from '../lib/router'
import { sortBy, SortTh, useSort } from '../lib/sort'
import type { Zone } from '../types'

/**
 * Vue globale, en lecture seule : toutes les zones côte à côte, puis les produits à travers les zones
 * (le SKU est l'identifiant). Un produit s'ouvre sur son détail zone par zone, compte par compte,
 * chacun dans sa devise. Les données se gèrent zone par zone, jamais d'ici.
 */
export function Global() {
  const { t } = useT()
  const { setZone } = useZone()
  const overview = useQuery(() => api.getGlobalOverview(), [])
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(15)
  const [picked, setPicked] = useState<string | null>(null)
  const { sort, toggle } = useSort()

  if (overview.error) return <div className="page"><ErrorBlock message={overview.error} onRetry={refresh} /></div>
  if (!overview.data) return <div className="page"><LoadingBlock /></div>

  const { zones, products } = overview.data
  const active = zones.filter((z) => z.retailers > 0 || z.products > 0)
  const totals = {
    retailers: zones.reduce((s, z) => s + z.scannable, 0),
    inAnomaly: zones.reduce((s, z) => s + z.inAnomaly, 0),
    confirmed: zones.reduce((s, z) => s + z.confirmed, 0),
    toReview: zones.reduce((s, z) => s + z.toReview, 0),
  }
  const goZone = (zone: Zone, path = '/') => {
    setZone(zone)
    navigate(path)
  }

  const rows = sortBy(
    products.filter((p) => !q || `${p.sku} ${p.item.model} ${p.item.material} ${p.item.color}`.toLowerCase().includes(q.trim().toLowerCase())),
    sort,
    {
      product: (p) => `${p.item.model} ${p.item.color}`,
      zones: (p) => p.zones.length,
      accounts: (p) => p.accounts,
      worst: (p) => p.worstDiscountPct,
      anomalies: (p) => p.anomalies,
    },
  )

  return (
    <div className="page">
      <PageHeader title={t('global.title')} subtitle={t('global.subtitle')} />

      <div className="stack">
        <div className="grid-kpi">
          <KpiCard icon="globe" label={t('global.zonesActive')} value={active.length} hint={t('kpi.outOfZones', { total: zones.length })} />
          <KpiCard icon="store" label={t('global.accountsTracked')} value={totals.retailers} hint={t('global.inAnomaly', { n: totals.inAnomaly })} />
          <KpiCard icon="alert" tone={totals.confirmed > 0 ? 'danger' : 'ok'} label={t('kpi.anomalies')} value={totals.confirmed} hint={t('global.allZones')} />
          <KpiCard icon="help" tone={totals.toReview > 0 ? 'warn' : 'ok'} label={t('kpi.toReview')} value={totals.toReview} hint={t('global.allZones')} />
        </div>

        <Card title={t('global.byZone')} flush>
          <table className="table table-rows">
            <thead>
              <tr>
                <th scope="col">{t('nav.zone')}</th>
                <th scope="col">{t('col.currency')}</th>
                <th scope="col" className="num">{t('global.accountsTracked')}</th>
                <th scope="col" className="num">{t('kpi.accounts')}</th>
                <th scope="col" className="num">{t('kpi.anomalies')}</th>
                <th scope="col" className="num">{t('kpi.toReview')}</th>
                <th scope="col" className="num">{t('col.maxDiscount')}</th>
                <th scope="col" className="num">{t('global.catalogue')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => {
                const empty = z.retailers === 0 && z.products === 0
                return (
                  <tr key={z.zone} className={`is-clickable${empty ? ' is-muted' : ''}`} onClick={() => goZone(z.zone)}>
                    <td>
                      <span className="cell-account">
                        <b>{z.zone}</b>
                      </span>
                    </td>
                    <td className="muted">{z.retailers > 0 ? z.currencies.join(' · ') : '—'}</td>
                    <td className="num">{empty ? '—' : z.scannable}</td>
                    <td className={`num ${z.inAnomaly > 0 ? 'danger strong' : ''}`}>{empty ? '—' : z.inAnomaly}</td>
                    <td className={`num ${z.confirmed > 0 ? 'danger strong' : ''}`}>{empty ? '—' : z.confirmed}</td>
                    <td className="num">{empty ? '—' : z.toReview}</td>
                    <td className="num">{z.worstDiscountPct > 0 ? <DiscountPill pct={z.worstDiscountPct} anomaly /> : <span className="muted">—</span>}</td>
                    <td className="num">{z.products || '—'}</td>
                    <td className="num">
                      {empty ? (
                        <Pill tone="neutral">{t('global.noData')}</Pill>
                      ) : (
                        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <span className="small muted">{t('global.open')}</span>
                          <Icon name="chevronRight" className="icon muted" />
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>

        <Card
          title={t('global.products')}
          flush
          action={
            <div className="search">
              <Icon name="search" />
              <input className="input" type="search" placeholder={t('products.search')} aria-label={t('products.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          }
        >
          {rows.length === 0 ? (
            <p className="card-empty">{t('products.noMatch')}</p>
          ) : (
            <table className="table table-rows">
              <thead>
                <tr>
                  <SortTh col="product" label={t('col.product')} sort={sort} onSort={toggle} />
                  <SortTh col="zones" label={t('global.colZones')} sort={sort} onSort={toggle} numeric />
                  <SortTh col="accounts" label={t('col.accounts')} sort={sort} onSort={toggle} numeric className="num" />
                  <SortTh col="worst" label={t('global.worst')} sort={sort} onSort={toggle} numeric />
                  <SortTh col="anomalies" label={t('col.anomalies')} sort={sort} onSort={toggle} numeric className="num" />
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((p) => (
                  <tr key={p.sku} className={`is-clickable ${p.anomalies > 0 ? 's-anomaly' : ''}`} onClick={() => setPicked(p.sku)}>
                    <td>
                      <span className="cell-account">
                        <ProductImage sku={p.sku} color={p.item.color} label={p.item.model} size={44} />
                        <span>
                          <b>
                            {p.item.model} {p.item.color}
                          </b>
                          <small>{t('label.sku', { value: p.sku })}</small>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="chips">
                        {p.zones.map((z) => (
                          <span key={z.zone} className={`pill ${z.anomalies > 0 ? 'pill-danger' : 'pill-neutral'}`} title={`${z.zone} · ${t('count.account', { n: z.accounts })} · ${formatMoney(z.lowest, z.currency)}`}>
                            {z.zone} {z.anomalies > 0 ? formatDiscount(z.worstDiscountPct) : ''}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="num">{p.accounts}</td>
                    <td>
                      {p.worstDiscountPct > 0 ? (
                        <span className="row" style={{ gap: 6 }}>
                          <DiscountPill pct={p.worstDiscountPct} anomaly={p.anomalies > 0} />
                          <span className="small muted">{p.worstZone}</span>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className={`num ${p.anomalies > 0 ? 'danger strong' : 'muted'}`}>{p.anomalies || '—'}</td>
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

      {picked && <GlobalProductDrawer sku={picked} onClose={() => setPicked(null)} onZone={goZone} />}
    </div>
  )
}

/** Un produit, zone par zone : chaque compte qui le vend, dans sa devise, avec son prix, le RRP et l'écart. */
function GlobalProductDrawer({ sku, onClose, onZone }: { sku: string; onClose: () => void; onZone: (zone: Zone, path: string) => void }) {
  const { t } = useT()
  const detail = useQuery(() => api.getGlobalProduct(sku), [sku])
  const d = detail.data
  return (
    <Drawer title={d ? `${d.item.model} ${d.item.material} ${d.item.color}` : sku} subtitle={t('label.sku', { value: sku })} onClose={onClose}>
      {detail.error ? (
        <ErrorBlock message={detail.error} onRetry={refresh} />
      ) : d === undefined ? (
        <LoadingBlock />
      ) : d === null ? (
        <Empty title={t('product.noData')} />
      ) : (
        <div className="stack">
          <div className="hero-product">
            <ProductImage sku={sku} color={d.item.color} label={d.item.model} size={120} />
            <div className="hero-prices">
              <div>
                <span className="k">{t('col.season')}</span>
                <b>
                  {d.item.season}
                  {d.item.carryOver ? ' · C/O' : ''}
                </b>
              </div>
              <div>
                <span className="k">{t('global.rrpByCurrency')}</span>
                <b className="small">{Object.entries(d.item.rrp).map(([cur, v]) => formatMoney(v!, cur)).join(' · ')}</b>
              </div>
            </div>
          </div>
          {d.zones.map((z) => (
            <Card key={z.zone} flush title={<span className="group-title">{z.zone} <em>{z.series.length}</em></span>} action={<button className="btn btn-ghost btn-sm" onClick={() => onZone(z.zone, `/produits/${encodeURIComponent(sku)}`)}>{t('global.openInZone')} <Icon name="arrowRight" /></button>}>
              <p className="small muted" style={{ padding: '8px 16px 0' }}>
                {t('product.rule')} : {z.discountLimitPct === undefined ? t('rule.unset') : z.discountLimitPct === 0 ? t('rule.none') : `${z.discountLimitPct} %`}
              </p>
              <div className="alist">
                {z.series.map((s) => (
                  <div key={s.retailerId} className={`arow arow-global${s.anomaly ? ' is-anomaly' : ''}`}>
                    <span className="arow-account">
                      <AccountLogo name={s.retailerName} size={36} />
                      <span>
                        <b>{s.retailerName}</b>
                        <small className="muted">{formatShortDate(s.points[s.points.length - 1]?.week ?? '')}</small>
                      </span>
                    </span>
                    <DiscountPill pct={s.discountPct} anomaly={s.anomaly} />
                    <span className={`arow-price ${s.anomaly ? 'danger' : 'ok'}`}>{formatMoney(s.currentPrice, s.currency)}</span>
                    <span className="muted small">{t('label.reference', { value: formatMoney(s.rrp, s.currency) })}</span>
                    <span className={`arow-state ${s.anomaly ? 'danger' : 'ok'}`} title={s.anomaly ? t('status.anomaly') : t('status.compliant')}>
                      <Icon name={s.anomaly ? 'xCircle' : 'checkCircle'} />
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Drawer>
  )
}
