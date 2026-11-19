import { api } from '../api'
import { AlertRow } from '../components/alerts'
import { Card, Empty, ErrorBlock, LoadingBlock, PageHeader } from '../components/ui'
import { refresh, useQuery, useZone } from '../lib/app'
import { useT, type TKey } from '../lib/i18n'
import type { Alert, AlertKind } from '../types'

const GROUPS: { kind: AlertKind; title: TKey }[] = [
  { kind: 'to-review', title: 'notif.group.toReview' },
  { kind: 'recurrence', title: 'notif.group.recurrence' },
  { kind: 'site-missing', title: 'notif.group.siteMissing' },
]

export function Notifications() {
  const { t } = useT()
  const { zone } = useZone()
  const alerts = useQuery(() => api.listAlerts(zone), [zone])

  if (alerts.error) return <div className="page"><ErrorBlock message={alerts.error} onRetry={refresh} /></div>
  if (!alerts.data) return <div className="page"><LoadingBlock /></div>

  const byKind = new Map<AlertKind, Alert[]>()
  for (const a of alerts.data) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a])

  return (
    <div className="page">
      <PageHeader title={t('notif.title')} subtitle={t('notif.note')} />
      {alerts.data.length === 0 ? (
        <Empty title={t('notif.empty')} />
      ) : (
        <div className="stack">
          {GROUPS.filter((g) => byKind.has(g.kind)).map((g) => {
            const list = byKind.get(g.kind)!
            return (
              <Card key={g.kind} flush action={g.kind === 'to-review' ? <a className="btn btn-primary btn-sm" href="#/identifier">{t('match.start')}</a> : undefined} title={<span className={`group-title kind-${g.kind}`}>{t(g.title)} <em>{list.length}</em></span>}>
                {list.map((a) => (
                  <AlertRow key={a.id} alert={a} />
                ))}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
