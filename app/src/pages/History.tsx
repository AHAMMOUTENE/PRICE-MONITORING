import { useState } from 'react'
import { api } from '../api'
import { ExportMenu } from '../components/ExportMenu'
import { Icon, type IconName } from '../components/Icon'
import { useToast } from '../components/toast'
import { Card, Empty, ErrorBlock, LoadingBlock, PageHeader, Pill } from '../components/ui'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatFullDate, formatShortDate } from '../lib/format'
import { useT, type TKey } from '../lib/i18n'
import { sortBy, SortTh, useSort } from '../lib/sort'
import { downloadWorkbook } from '../lib/xlsx-export'
import type { ActivityItem } from '../types'

const KIND: Record<ActivityItem['kind'], { icon: IconName; key: TKey }> = {
  accepted: { icon: 'check', key: 'activity.accepted' },
  corrected: { icon: 'refresh', key: 'activity.corrected' },
  'no-match': { icon: 'ban', key: 'activity.dismissed' },
  commented: { icon: 'comment', key: 'activity.commented' },
}

type Tab = 'scans' | 'actions'

/**
 * Historique en deux onglets, pour ne pas mélanger deux sujets :
 *  - les scans passés, une ligne par semaine ;
 *  - les actions de l'équipe (produits identifiés, commentaires), groupées par jour.
 */
export function History() {
  const { t } = useT()
  const { zone } = useZone()
  const toast = useToast()
  const history = useQuery(() => api.listHistory(zone), [zone])
  const [tab, setTab] = useState<Tab>('scans')
  const [busy, setBusy] = useState<string | null>(null)
  const { sort, toggle } = useSort()

  if (history.error) return <div className="page"><ErrorBlock message={history.error} onRetry={refresh} /></div>
  if (!history.data) return <div className="page"><LoadingBlock /></div>

  const { weeks, activity } = history.data
  // L'évolution se calcule sur l'ordre chronologique, avant tout tri.
  const scans = sortBy(
    weeks.map((w, i) => ({ ...w, delta: weeks[i + 1] ? w.confirmed - weeks[i + 1].confirmed : null, isCurrent: i === 0 })),
    sort,
    { week: (w) => w.weekOf, confirmed: (w) => w.confirmed, delta: (w) => w.delta, toReview: (w) => w.toReview, accounts: (w) => w.accountsInAnomaly },
  )

  const exportWeek = async (week: string) => {
    setBusy(week)
    try {
      await downloadWorkbook(await api.buildExport(zone, { fromWeek: week, toWeek: week, retailerIds: [], proof: 'all' }))
      toast.show(t('common.exported'))
    } finally {
      setBusy(null)
    }
  }

  // Actions groupées par jour, du plus récent au plus ancien.
  const days = new Map<string, ActivityItem[]>()
  for (const a of activity) days.set(a.at, [...(days.get(a.at) ?? []), a])

  return (
    <div className="page">
      <PageHeader title={t('history.title')} subtitle={t('history.subtitle')} actions={<ExportMenu weekOf={weeks[0].weekOf} weeks={weeks.map((w) => w.weekOf)} />} />

      <div className="seg seg-lg" role="tablist" aria-label={t('history.title')}>
        <button role="tab" aria-selected={tab === 'scans'} aria-pressed={tab === 'scans'} onClick={() => setTab('scans')}>
          {t('history.tabScans')} <em>{weeks.length}</em>
        </button>
        <button role="tab" aria-selected={tab === 'actions'} aria-pressed={tab === 'actions'} onClick={() => setTab('actions')}>
          {t('history.tabActions')} <em>{activity.length}</em>
        </button>
      </div>

      {tab === 'scans' ? (
        <Card flush>
          <table className="table table-rows">
            <thead>
              <tr>
                <SortTh col="week" label={t('history.colWeek')} sort={sort} onSort={toggle} numeric />
                <SortTh col="confirmed" label={t('kpi.anomalies')} sort={sort} onSort={toggle} numeric className="num" />
                <SortTh col="delta" label={t('history.colChange')} sort={sort} onSort={toggle} numeric className="num" />
                <SortTh col="toReview" label={t('kpi.toReview')} sort={sort} onSort={toggle} numeric className="num" />
                <SortTh col="accounts" label={t('kpi.accounts')} sort={sort} onSort={toggle} numeric className="num" />
                <th scope="col" className="num">{t('history.colFile')}</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((w) => {
                const delta = w.delta
                return (
                  <tr key={w.weekOf}>
                    <td className="strong">
                      {formatFullDate(w.weekOf)} {w.isCurrent && <Pill tone="ok">{t('common.current')}</Pill>}
                    </td>
                    <td className="num strong">{w.confirmed}</td>
                    <td className={`num ${delta === null || delta === 0 ? 'muted' : delta > 0 ? 'danger' : 'ok'}`}>
                      {delta === null ? '—' : delta === 0 ? '=' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`}
                    </td>
                    <td className="num">{w.toReview}</td>
                    <td className="num">{w.accountsInAnomaly}</td>
                    <td className="num">
                      <button className="btn btn-ghost btn-sm" onClick={() => exportWeek(w.weekOf)} disabled={busy === w.weekOf} aria-label={`${t('common.export')} ${formatShortDate(w.weekOf)}`}>
                        <Icon name="download" /> Excel
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      ) : activity.length === 0 ? (
        <Empty title={t('history.noActivity')} />
      ) : (
        <div className="stack">
          {[...days.entries()].map(([day, items]) => (
            <Card key={day} flush title={<span className="group-title">{formatFullDate(day)} <em>{items.length}</em></span>}>
              <div className="timeline">
                {items.map((a) => (
                  <div key={a.id} className={`tl-item kind-${a.kind}`}>
                    <span className="tl-icon">
                      <Icon name={KIND[a.kind].icon} />
                    </span>
                    <span className="tl-text">
                      <b>{t(KIND[a.kind].key)}</b>
                      <span>{[a.title ? t('label.product', { value: a.title }) : '', a.retailerName ? t('label.account', { name: a.retailerName }) : '', a.note ? `« ${a.note} »` : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="tl-who">{a.by ? t('activity.by', { name: a.by }) : ''}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
