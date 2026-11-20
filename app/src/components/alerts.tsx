import { AccountLogo } from './ui'
import { useT, type TKey, type Params } from '../lib/i18n'
import { formatDiscount } from '../lib/format'
import type { Alert } from '../types'

type T = (key: TKey, params?: Params) => string

/** Texte court d'une alerte : toujours « ce retailer est à revoir », avec la raison. */
export function alertMessage(t: T, a: Alert): string {
  switch (a.kind) {
    case 'review':
      return t('notif.msg.review', { n: a.products, pct: formatDiscount(a.maxDiscountPct ?? 0) })
    case 'recurrence':
      return t('notif.msg.recurrence', { gap: a.gapWeeks ?? 0 })
    case 'to-review':
      return t('notif.msg.toReview', { n: a.products })
    case 'site-missing':
      return t('notif.msg.siteMissing')
  }
}

export function AlertRow({ alert: a, compact = false }: { alert: Alert; compact?: boolean }) {
  const { t } = useT()
  const account = `#/comptes/${encodeURIComponent(a.retailerId)}`

  const action =
    a.kind === 'to-review' ? (
      <a className="btn btn-secondary btn-sm" href={`#/identifier?retailer=${encodeURIComponent(a.retailerId)}`}>
        {t('notif.action.validate')}
      </a>
    ) : a.kind === 'site-missing' ? (
      <a className="btn btn-secondary btn-sm" href={`#/reglages/comptes?edit=${encodeURIComponent(a.retailerId)}`}>
        {t('notif.action.addSite')}
      </a>
    ) : (
      <a className="btn btn-secondary btn-sm" href={account}>
        {t('notif.action.open')}
      </a>
    )

  return (
    <div className={`alert kind-${a.kind}${compact ? ' is-compact' : ''}`}>
      <AccountLogo name={a.retailerName} size={compact ? 34 : 40} />
      <div className="alert-text">
        <a className="alert-name" href={account}>
          {t('label.account', { name: a.retailerName })}
        </a>
        <span>{alertMessage(t, a)}</span>
      </div>
      {!compact ? action : null}
    </div>
  )
}
