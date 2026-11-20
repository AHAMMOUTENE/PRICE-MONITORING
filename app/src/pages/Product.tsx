import type { ProductSeries } from '../types'
import { useState } from 'react'
import { api } from '../api'
import { LineChart } from '../components/charts'
import { Icon } from '../components/Icon'
import { AccountLogo, Card, DiscountPill, Empty, ErrorBlock, LoadingBlock, PageHeader, Pill, ProductImage, SERIES_COLORS } from '../components/ui'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatMoney, formatMoneyShort, formatShortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRoute } from '../lib/router'
import { sortBy, SortHead, useSort } from '../lib/sort'

/**
 * Un produit et tous les comptes où il est vendu : courbes de prix, puis une ligne par compte.
 * Les sites d'une zone peuvent être en devises différentes : les courbes se lisent dans une devise à la fois.
 */
export function Product() {
  const { t } = useT()
  const { zone } = useZone()
  const { path, params } = useRoute()
  const sku = decodeURIComponent(path.split('/')[2] ?? '')
  const weekParam = params.get('week')
  const product = useQuery(() => api.getProduct(zone, sku, weekParam ?? undefined), [zone, sku, weekParam])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState('')
  const [focus, setFocus] = useState<string | null>(null) // compte de la légende survolé : sa courbe passe au premier plan
  const { sort, toggle: sortBy_ } = useSort()
  const back = { href: `#/produits${weekParam ? `?week=${weekParam}` : ''}`, label: t('nav.products') }

  if (product.error) return <div className="page"><ErrorBlock message={product.error} onRetry={refresh} /></div>
  if (product.data === undefined) return <div className="page"><LoadingBlock /></div>
  if (product.data === null) {
    return (
      <div className="page">
        <PageHeader title={t('product.notFound')} back={back} />
        <Empty title={t('product.noData')} />
      </div>
    )
  }

  const d = product.data
  const currency = d.currencies.includes(picked) ? picked : (d.currencies[0] ?? Object.keys(d.item.rrp)[0] ?? 'EUR')
  const inCurrency = d.series.filter((s) => s.currency === currency) // déjà classées par remise décroissante
  const rrp = inCurrency[0]?.rrp ?? d.item.rrp[currency] ?? 0
  const lowest = inCurrency.reduce((a, b) => (b.currentPrice < a.currentPrice ? b : a), inCurrency[0])
  const perRetailer = new Map<string, number>()
  for (const x of d.series) perRetailer.set(x.retailerId, (perRetailer.get(x.retailerId) ?? 0) + 1)
  const labelOf = (x: ProductSeries) => ((perRetailer.get(x.retailerId) ?? 0) > 1 ? `${x.retailerName} · ${x.title.length > 28 ? `${x.title.slice(0, 28)}…` : x.title}` : x.retailerName)
  const colors = new Map(d.series.map((s, i) => [s.key, SERIES_COLORS[i % SERIES_COLORS.length]]))
  const visible = inCurrency.filter((s) => !hidden.has(s.key))
  const rows = sortBy(d.series, sort, {
    account: (s) => s.retailerName,
    discount: (s) => s.discountPct,
    currentPrice: (s) => s.currentPrice,
    change: (s) => s.change,
    status: (s) => (s.anomaly ? 0 : 1),
  })
  const toggle = (id: string) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="page">
      <PageHeader
        back={back}
        lead={<ProductImage src={d.item.image} sku={sku} color={d.item.color} label={d.item.model} size={52} />}
        title={`${d.item.model} ${d.item.material} ${d.item.color}`}
        subtitle={`${t('label.sku', { value: sku })} · ${t('label.season', { value: `${d.item.season}${d.item.carryOver ? ' · C/O' : ''}` })} · ${t('product.soldAt', { n: d.series.length })}`}
      />

      <Card className="hero">
        <div className="hero-grid">
          <div className="hero-product">
            <ProductImage src={d.item.image} sku={sku} color={d.item.color} label={d.item.model} size={168} />
            <div className="hero-prices">
              <div>
                <span className="k">{t('product.referencePrice')}</span>
                <b>{formatMoney(rrp, currency)}</b>
              </div>
              {lowest && (
                <div>
                  <span className="k">{t('product.lowest')}</span>
                  <b className={lowest.anomaly ? 'danger' : 'ok'}>{formatMoney(lowest.currentPrice, currency)}</b>
                </div>
              )}
              <div>
                <span className="k">{t('product.rule')}</span>
                <b>{d.discountLimitPct === undefined ? t('rule.unset') : d.discountLimitPct === 0 ? t('rule.none') : `${d.discountLimitPct} %`}</b>
              </div>
            </div>
          </div>
          <div className="hero-chart">
            {d.series.length === 0 ? (
              <p className="muted">{t('product.noConfirmed')}</p>
            ) : (
              <>
            {d.currencies.length > 1 && (
              <div className="seg" role="group" aria-label={t('col.currency')} style={{ marginBottom: 10 }}>
                {d.currencies.map((c) => (
                  <button key={c} aria-pressed={c === currency} onClick={() => setPicked(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="legend" role="group" aria-label={t('product.byAccount')}>
              {inCurrency.map((s) => {
                const off = hidden.has(s.key)
                return (
                  <button key={s.key} className={`legend-item${off ? ' is-off' : ''}`} aria-pressed={!off} title={t('product.toggle', { name: labelOf(s) })} onClick={() => toggle(s.key)} onMouseEnter={() => setFocus(s.key)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(s.key)} onBlur={() => setFocus(null)}>
                    <i style={{ background: colors.get(s.key) }} />
                    {labelOf(s)}
                  </button>
                )
              })}
            </div>
            <LineChart
              highlightId={focus}
              ariaLabel={t('product.priceEvolution')}
              labels={d.weeks.map(formatShortDate)}
              formatY={(v) => formatMoneyShort(v, currency)}
              height={300}
              series={[
                ...visible.map((s) => ({ id: s.key, label: labelOf(s), color: colors.get(s.key)!, values: s.points.map((p) => p.price) })),
                { id: 'ref', label: t('chart.reference'), color: '#6b7379', dashed: true, values: d.weeks.map(() => rrp) },
              ]}
            />
              </>
            )}
          </div>
        </div>
      </Card>

      <Card title={t('product.byAccount')} flush className="mt">
        <div className="alist">
          <div className="arow arow-head">
            <SortHead col="account" label={t('col.account')} sort={sort} onSort={sortBy_} />
            <SortHead col="discount" label={t('col.discount')} sort={sort} onSort={sortBy_} numeric />
            <SortHead col="currentPrice" label={t('col.currentPrice')} sort={sort} onSort={sortBy_} numeric />
            <SortHead col="change" label={t('col.change')} sort={sort} onSort={sortBy_} numeric />
            <span>{t('col.page')}</span>
            <SortHead col="status" label={t('col.status')} sort={sort} onSort={sortBy_} />
          </div>
          {rows.map((s) => (
            <div key={s.key} className={`arow${s.anomaly ? ' is-anomaly' : ''}`}>
              <a className="arow-account" href={`#/comptes/${encodeURIComponent(s.retailerId)}`}>
                <AccountLogo name={s.retailerName} size={44} />
                <span>
                  <b>{s.retailerName}</b>
                  {(perRetailer.get(s.retailerId) ?? 0) > 1 && <small className="muted">{s.title}</small>}
                </span>
              </a>
              <DiscountPill pct={s.discountPct} anomaly={s.anomaly} />
              <span className={`arow-price ${s.anomaly ? 'danger' : 'ok'}`}>{formatMoney(s.currentPrice, s.currency)}</span>
              <span className="arow-change">
                {s.change === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <Pill tone={s.change < 0 ? 'danger' : 'ok'} icon={s.change < 0 ? 'arrowDown' : 'arrowUp'}>
                    {formatMoney(Math.abs(s.change), s.currency)}
                  </Pill>
                )}
              </span>
              <a className="iconbtn" href={s.url} target="_blank" rel="noreferrer" aria-label={t('anomaly.viewPage')}>
                <Icon name="external" />
              </a>
              <span className={`arow-state ${s.anomaly ? 'danger' : 'ok'}`} title={s.anomaly ? t('status.anomaly') : t('status.compliant')}>
                <Icon name={s.anomaly ? 'xCircle' : 'checkCircle'} />
              </span>
            </div>
          ))}
        </div>
      </Card>

      {d.candidates.length > 0 && (
        <Card title={t('product.candidates', { n: d.candidates.length })} className="mt">
          <p className="small muted">{t('product.candidatesHint')}</p>
          <div className="alist">
            {d.candidates.map((c) => (
              <div key={c.key} className="arow">
                <a className="arow-account" href={`#/comptes/${encodeURIComponent(c.retailerId)}`}>
                  <AccountLogo name={c.retailerName} size={44} />
                  <span>
                    <b>{c.retailerName}</b>
                    <small className="muted">{c.title}</small>
                  </span>
                </a>
                <span className="small muted">{c.confidence !== undefined ? t('product.confidence', { pct: Math.round(c.confidence * 100) }) : ''}</span>
                <span className="arow-price">{formatMoney(c.currentPrice, c.currency)}</span>
                <a className="btn btn-secondary btn-sm" href={`#/identifier?retailer=${encodeURIComponent(c.retailerId)}&product=${encodeURIComponent(c.key)}`}>
                  {t('product.identify')}
                </a>
                <a className="iconbtn" href={c.url} target="_blank" rel="noreferrer" aria-label={t('anomaly.viewPage')}>
                  <Icon name="external" />
                </a>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
