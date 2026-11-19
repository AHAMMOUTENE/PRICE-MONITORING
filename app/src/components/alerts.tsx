import { AccountLogo } from './ui'
import { useT, type TKey, type Params } from '../lib/i18n'
import type { Alert } from '../types'

type T = (key: TKey, params?: Params) => string

/** Texte court d'une alerte, dans la langue de l'interface. */
export function alertMessage(t: T, a: Alert): string {
  switch (a.kind) {
    case 'to-review':
      return t('notif.msg.toReview', { n: a.products })
    case 'recurrence':
      return t('notif.msg.recurrence', { gap: a.gapWeeks ?? 0 })
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
      <a className="btn btn-ghost btn-sm" href={account}>
        {t('notif.action.open')}
      </a>
    )

  return (
    <div className={`alert kind-${a.kind}${compact ? ' is-compact' : ''}`}>
      <AccountLogo name={a.retailerName} size={compact ? 34 : 40} />
      <div className="alert-text">
        <a className="alert-name" href={account}>
          {a.retailerName}
        </a>
        <span>{alertMessage(t, a)}</span>
      </div>
      {!compact ? action : null}
    </div>
  )
}
