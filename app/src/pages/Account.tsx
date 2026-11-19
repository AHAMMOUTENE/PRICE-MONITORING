import { useState } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { SeeMore } from '../components/SeeMore'
import { useToast } from '../components/toast'
import { AccountDrawer } from './settings/Accounts'
import { AccountLogo, Card, DiscountPill, Empty, ErrorBlock, LoadingBlock, PageHeader, ProductImage } from '../components/ui'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatDiscount, formatFullDate, formatMoney, formatShortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRoute } from '../lib/router'
import { sortBy, SortHead, useSort } from '../lib/sort'
import type { AccountProduct } from '../types'

/**
 * La fiche d'un compte, de haut en bas :
 *  1. qui est ce compte ;
 *  2. ce qui demande une action : compte exclu des règles, produits à identifier (liste dépliante) ;
 *  3. ses produits en anomalie, les conformes repliés ;
 *  4. les commentaires de l'équipe sur ce compte.
 */
export function Account() {
  const { t } = useT()
  const { zone } = useZone()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const { path, params } = useRoute()
  const id = decodeURIComponent(path.split('/')[2] ?? '')
  const weekParam = params.get('week') ?? undefined
  const overview = useQuery(() => api.getWeek(zone, weekParam), [zone, weekParam])
  const products = useQuery(() => api.listAccountProducts(zone, id, weekParam ?? ''), [zone, id, weekParam])
  const [showOk, setShowOk] = useState(false)
  const [limitMain, setLimitMain] = useState(10)
  const [limitOk, setLimitOk] = useState(10)
  const { sort, toggle } = useSort()
  const [openIdentify, setOpenIdentify] = useState(false)
  const back = { href: `#/comptes${weekParam ? `?week=${weekParam}` : ''}`, label: t('nav.accounts') }

  if (overview.error) return <div className="page page-narrow"><ErrorBlock message={overview.error} onRetry={refresh} /></div>
  if (!overview.data) return <div className="page page-narrow"><LoadingBlock /></div>

  const o = overview.data
  const row = o.retailers.find((r) => r.retailer.id === id)
  if (!row) return <div className="page page-narrow"><PageHeader title={t('accounts.empty')} back={back} /></div>

  const r = row.retailer
  const list = products.data ?? []
  const toIdentify = list.filter((p) => p.proof === 'to-review' && p.reason)
  const rest = list.filter((p) => !(p.proof === 'to-review' && p.reason))
  const getters = {
    product: (p: AccountProduct) => p.title,
    sitePrice: (p: AccountProduct) => p.salePrice,
    reference: (p: AccountProduct) => p.rrp,
    discount: (p: AccountProduct) => p.discountPct,
  }
  const bad = sortBy(rest.filter((p) => p.reason), sort, getters)
  const ok = sortBy(rest.filter((p) => !p.reason), sort, getters)

  // La règle est celle du produit (remise autorisée propre, sinon celle de la zone).
  const reasonText = (p: AccountProduct) => (p.reason === 'non-discounted-model' ? t('reason.nonDiscounted') : t('reason.overMax', { max: p.discountLimitPct ?? 0 }))

  const copy = async () => {
    const lines = [
      t('summary.title', { name: r.name, date: formatShortDate(o.weekOf) }),
      t('count.product', { n: bad.length }),
      '',
      ...bad.flatMap((p) => [
        t('summary.line', {
          title: p.title,
          sku: p.sku ? ` (${p.sku})` : '',
          price: formatMoney(p.salePrice, p.currency),
          ref: formatMoney(p.rrp, p.currency),
          disc: formatDiscount(p.discountPct),
          reason: reasonText(p),
        }),
        `  ${p.url}`,
      ]),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.show(t('account.copied'))
    } catch {
      toast.show(t('account.copyDenied'))
    }
  }

  const subtitle = [r.segmentation ? t('label.segmentation', { value: r.segmentation }) : '', r.salesReps.length ? t('label.rep', { value: r.salesReps.join(', ') }) : '']
    .filter(Boolean)
    .join(' · ')
  const productRow = (p: AccountProduct) => {
    const anomaly = Boolean(p.reason)
    const href = p.sku ? `#/produits/${encodeURIComponent(p.sku)}` : undefined
    return (
      <a key={p.id} className={`pitem${anomaly ? ' is-anomaly' : ''}`} href={href} onClick={href ? undefined : (e) => e.preventDefault()}>
        <ProductImage src={p.image} sku={p.sku} color={p.color} label={p.title} size={52} />
        <span className="pitem-text">
          <b>{p.title}</b>
          <span>{anomaly ? t('label.reason', { value: reasonText(p) }) : t('label.color', { value: p.color })}</span>
        </span>
        <span className={`pitem-price${anomaly ? ' danger' : ''}`}>{formatMoney(p.salePrice, p.currency)}</span>
        <span className="pitem-ref">{formatMoney(p.rrp, p.currency)}</span>
        <DiscountPill pct={p.discountPct} anomaly={anomaly} />
        <Icon name="chevronRight" className="icon muted" />
      </a>
    )
  }

  const listHead = (
    <div className="pitem pitem-head">
      <span />
      <SortHead col="product" label={t('col.product')} sort={sort} onSort={toggle} />
      <SortHead col="sitePrice" label={t('label.sitePrice')} sort={sort} onSort={toggle} numeric />
      <SortHead col="reference" label={t('col.reference')} sort={sort} onSort={toggle} numeric />
      <SortHead col="discount" label={t('col.discount')} sort={sort} onSort={toggle} numeric />
      <span />
    </div>
  )

  return (
    <div className="page page-narrow">
      <PageHeader
        back={back}
        lead={<AccountLogo name={r.name} size={52} />}
        title={r.name}
        subtitle={subtitle}
        actions={
          <>
            {bad.length > 0 && (
              <button className="btn btn-secondary" onClick={copy}>
                <Icon name="copy" /> {t('account.copySummary')}
              </button>
            )}
            {r.sites[0] && (
              <a className="btn btn-secondary" href={r.sites[0].url} target="_blank" rel="noreferrer">
                {t('account.viewSite')} <Icon name="external" />
              </a>
            )}
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              <Icon name="edit" /> {t('account.editAccount')}
            </button>
            {editing && <AccountDrawer initial={r} onClose={() => setEditing(false)} />}
          </>
        }
      />

      {row.status === 'no-site' ? (
        <Empty
          title={t('account.noSite')}
          action={
            <a className="btn btn-primary" href={`#/reglages/comptes?edit=${encodeURIComponent(r.id)}`}>
              {t('account.addSite')}
            </a>
          }
        />
      ) : (
        <>
          {(toIdentify.length > 0 || row.status === 'excluded') && (
            <div className="banners">
              {row.status === 'excluded' && (
                <div className="status-banner tone-neutral">
                  <div className="status-main">
                    <span className="status-icon">
                      <Icon name="ban" />
                    </span>
                    <span className="status-text">
                      <b>{t('status.excluded')}</b>
                      <span>{t('account.excluded')}</span>
                    </span>
                    <a className="btn btn-secondary btn-sm" href={`#/reglages/comptes?edit=${encodeURIComponent(r.id)}`}>
                      {t('account.editAccount')}
                    </a>
                  </div>
                </div>
              )}

              {toIdentify.length > 0 && (
                <div className="status-banner tone-warn" data-tour="to-identify">
                  <button className="status-main is-button" onClick={() => setOpenIdentify((v) => !v)} aria-expanded={openIdentify}>
                    <span className="status-icon">
                      <Icon name="help" />
                    </span>
                    <span className="status-text">
                      <b>{t('notif.msg.toReview', { n: toIdentify.length })}</b>
                    </span>
                    <Icon name={openIdentify ? 'chevronUp' : 'chevronDown'} className="icon status-chev" />
                  </button>
                  {openIdentify && (
                    <div className="status-panel" role="list">
                      {toIdentify.map((p) => (
                        <a key={p.id} role="listitem" className="hrow" href={`#/identifier?retailer=${encodeURIComponent(r.id)}&product=${encodeURIComponent(p.id)}`}>
                          <ProductImage src={p.image} color={p.color} label={p.title} size={36} />
                          <span className="hrow-text">
                            <b>{p.title}</b>
                            <span>
                              {t('label.sitePriceValue', { value: formatMoney(p.salePrice, p.currency) })} · {t('label.discount', { value: formatDiscount(p.discountPct) })}
                            </span>
                          </span>
                          <span className="who">{t('notif.action.validate')}</span>
                          <Icon name="chevronRight" className="icon muted" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {products.error ? (
            <ErrorBlock message={products.error} onRetry={refresh} />
          ) : !products.data ? (
            <LoadingBlock />
          ) : bad.length === 0 && ok.length === 0 ? (
            <Empty title={t('account.noProducts')} />
          ) : (
            <>
              <Card title={<span className="group-title">{bad.length > 0 ? t('col.anomalies') : t('account.products')} <em>{bad.length > 0 ? bad.length : ok.length}</em></span>} flush>
                <div className="plist">
                  {listHead}
                  {(bad.length > 0 ? bad : ok).slice(0, limitMain).map(productRow)}
                </div>
                <SeeMore total={(bad.length > 0 ? bad : ok).length} limit={limitMain} step={10} onMore={() => setLimitMain((n) => n + 10)} />
              </Card>

              {bad.length > 0 && ok.length > 0 && (
                <>
                  <button className="linkbtn" onClick={() => setShowOk((v) => !v)} aria-expanded={showOk}>
                    {showOk ? t('account.hideCompliant') : t('account.showCompliant', { n: ok.length })}
                    <Icon name={showOk ? 'chevronUp' : 'chevronDown'} />
                  </button>
                  {showOk && (
                    <Card title={<span className="group-title">{t('status.compliant')} <em>{ok.length}</em></span>} flush>
                      <div className="plist">
                        {listHead}
                        {ok.slice(0, limitOk).map(productRow)}
                      </div>
                      <SeeMore total={ok.length} limit={limitOk} step={10} onMore={() => setLimitOk((n) => n + 10)} />
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      <div data-tour="comments">
        <Comments retailerId={r.id} />
      </div>
    </div>
  )
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

/** Le carnet de l'équipe sur ce compte : un champ pour écrire, puis les commentaires du plus récent au plus ancien. */
function Comments({ retailerId }: { retailerId: string }) {
  const { t } = useT()
  const toast = useToast()
  const list = useQuery(() => api.listComments(retailerId), [retailerId])
  const [text, setText] = useState('')
  const [limit, setLimit] = useState(3)
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await api.addComment(retailerId, text)
      setText('')
      refresh()
      toast.show(t('comments.added'))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    await api.removeComment(id)
    refresh()
    toast.show(t('comments.deleted'))
  }

  const items = list.data ?? []
  return (
    <Card title={<span className="group-title">{t('comments.title')} <em>{items.length}</em></span>} className="mt">
      <div className="comment-form">
        <textarea
          className="input"
          rows={2}
          placeholder={t('comments.placeholder')}
          aria-label={t('comments.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add()
          }}
        />
        <button className="btn btn-primary" onClick={add} disabled={!text.trim() || busy}>
          <Icon name="plus" /> {t('comments.add')}
        </button>
      </div>
      <p className="small muted comment-hint">{t('comments.hint')}</p>
      {list.error ? (
        <ErrorBlock message={list.error} onRetry={refresh} />
      ) : !list.data ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <p className="small muted">{t('comments.none')}</p>
      ) : (
        <ul className="comments">
          {items.slice(0, limit).map((c) => (
            <li key={c.id} className="comment">
              <span className="comment-avatar" aria-hidden="true">
                {initials(c.by)}
              </span>
              <span className="comment-body">
                <span className="comment-meta">{t('comments.by', { name: c.by, date: formatFullDate(c.at.slice(0, 10)) })}</span>
                <span className="comment-text">{c.text}</span>
              </span>
              {c.mine && (
                <button className="iconbtn" aria-label={t('comments.delete')} title={t('comments.delete')} onClick={() => remove(c.id)}>
                  <Icon name="trash" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <SeeMore total={items.length} limit={limit} step={10} onMore={() => setLimit((n) => n + 10)} />
    </Card>
  )
}
