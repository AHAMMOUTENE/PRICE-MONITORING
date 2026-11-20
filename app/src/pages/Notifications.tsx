import { useEffect, useState } from 'react'
import { api } from '../api'
import { AlertRow } from '../components/alerts'
import { useToast } from '../components/toast'
import { Card, Empty, ErrorBlock, LoadingBlock, PageHeader } from '../components/ui'
import { refresh, useQuery, useZone } from '../lib/app'
import { useT, type TKey } from '../lib/i18n'
import type { Alert, AlertKind, EmailKind, EmailPrefs } from '../types'

/** Les alertes : des retailers à revoir. */
const GROUPS: { kind: AlertKind; title: TKey }[] = [
  { kind: 'review', title: 'notif.group.review' },
  { kind: 'recurrence', title: 'notif.group.recurrence' },
]
/** Les tâches : identifier des produits, ajouter des sites. Elles ne comptent pas dans le compteur d'alertes du menu. */
const TODO: { kind: AlertKind; title: TKey }[] = [
  { kind: 'to-review', title: 'notif.group.toReview' },
  { kind: 'site-missing', title: 'notif.group.siteMissing' },
]
const EMAIL_KINDS: { kind: EmailKind; label: TKey }[] = [
  { kind: 'review', label: 'notif.email.review' },
  { kind: 'recurrence', label: 'notif.email.recurrence' },
  { kind: 'todo', label: 'notif.email.todo' },
]

/**
 * Tout en haut : recevoir un e-mail après chaque scan de la zone, avec les rubriques de son choix (désactivé par défaut).
 * L'e-mail liste ce qu'il faut redresser et renvoie vers l'application.
 */
function EmailToggle() {
  const { t } = useT()
  const { zone } = useZone()
  const toast = useToast()
  const prefs = useQuery(() => api.getEmailPrefs(zone), [zone])
  const [local, setLocal] = useState<EmailPrefs | null>(null)
  useEffect(() => setLocal(prefs.data ?? null), [prefs.data])
  if (!local) return null

  const save = async (patch: { enabled?: boolean; kinds?: EmailKind[] }) => {
    setLocal({ ...local, ...patch })
    try {
      await api.saveEmailPrefs(zone, patch)
      toast.show(t('toast.saved'))
    } catch {
      setLocal(local)
      toast.show(t('common.error'))
    }
  }
  const toggleKind = (k: EmailKind) => save({ kinds: local.kinds.includes(k) ? local.kinds.filter((x) => x !== k) : [...local.kinds, k] })

  return (
    <div className="mailcard">
      <div className="mailcard-row">
        <span className="mailcard-text">
          <b>{t('notif.email.title', { zone })}</b>
          <span className="small muted">{t('notif.email.hint')}</span>
        </span>
        <label className="switch" title={t('notif.email.title', { zone })}>
          <input type="checkbox" role="switch" aria-label={t('notif.email.title', { zone })} checked={local.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-text">{local.enabled ? t('sAccounts.on') : t('sAccounts.off')}</span>
        </label>
      </div>
      {local.enabled && (
        <div className="mailcard-kinds">
          <span className="small muted">{t('notif.email.kinds')}</span>
          {EMAIL_KINDS.map((k) => (
            <label key={k.kind} className="opt">
              <input type="checkbox" checked={local.kinds.includes(k.kind)} onChange={() => toggleKind(k.kind)} />
              <span>{t(k.label)}</span>
            </label>
          ))}
          {!local.configured && <span className="small muted">{t('notif.email.notConfigured')}</span>}
        </div>
      )}
    </div>
  )
}

export function Notifications() {
  const { t } = useT()
  const { zone } = useZone()
  const alerts = useQuery(() => api.listAlerts(zone), [zone])

  if (alerts.error) return <div className="page"><ErrorBlock message={alerts.error} onRetry={refresh} /></div>
  if (!alerts.data) return <div className="page"><LoadingBlock /></div>

  const byKind = new Map<AlertKind, Alert[]>()
  for (const a of alerts.data) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a])

  const group = (g: { kind: AlertKind; title: TKey }, list: Alert[]) => (
    <Card key={g.kind} flush action={g.kind === 'to-review' ? <a className="btn btn-primary btn-sm" href="#/identifier">{t('match.start')}</a> : undefined} title={<span className={`group-title kind-${g.kind}`}>{t(g.title)} <em>{list.length}</em></span>}>
      {list.map((a) => (
        <AlertRow key={a.id} alert={a} />
      ))}
    </Card>
  )

  return (
    <div className="page">
      <PageHeader title={t('notif.title')} />
      <EmailToggle />
      {alerts.data.length === 0 ? (
        <Empty title={t('notif.empty')} />
      ) : (
        <>
          {GROUPS.some((g) => byKind.has(g.kind)) ? (
            <div className="stack">{GROUPS.filter((g) => byKind.has(g.kind)).map((g) => group(g, byKind.get(g.kind)!))}</div>
          ) : (
            <p className="muted">{t('notif.noneToReview')}</p>
          )}
          {TODO.some((g) => byKind.has(g.kind)) && (
            <>
              <h2 className="notif-section">{t('todo.title')}</h2>
              <div className="stack">{TODO.filter((g) => byKind.has(g.kind)).map((g) => group(g, byKind.get(g.kind)!))}</div>
            </>
          )}
        </>
      )}
    </div>
  )
}
