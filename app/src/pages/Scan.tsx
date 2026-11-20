import { useEffect } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { ScanProgress, useScanRunner } from '../components/ScanButton'
import { Card, Empty, ErrorBlock, LoadingBlock, PageHeader, Pill } from '../components/ui'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatDateTime, formatMoney } from '../lib/format'
import { useT, type TKey } from '../lib/i18n'
import type { ScanRecord } from '../types'

const TONE: Record<ScanRecord['status'], 'ok' | 'warn' | 'danger' | 'neutral'> = { queued: 'neutral', running: 'neutral', done: 'ok', partial: 'warn', failed: 'danger', cancelled: 'neutral' }

/** « arrêté : circuit-open » → texte clair dans la langue de l'utilisateur ; un message inconnu est affiché tel quel. */
function useReason() {
  const { t } = useT()
  return (error?: string | null): string => {
    if (!error) return ''
    const code = error.replace(/^arrêté : /, '')
    const key = `scan.reason.${code}` as TKey
    const text = t(key)
    return text === key ? error : text
  }
}

/**
 * Rubrique « Scanner » : lancer un scan en choisissant les saisons de produits à enregistrer,
 * et retrouver l'historique des passages (date, durée, pages, produits vus, crédits, raison d'un arrêt).
 */
export function Scan() {
  const { t } = useT()
  const { zone } = useZone()
  const reason = useReason()
  const history = useQuery(() => api.listScans(zone), [zone])
  const { progress, ask, confirm } = useScanRunner()

  const running = progress !== null || Boolean(history.data?.some((s) => s.status === 'running' || s.status === 'queued'))
  // Pendant un scan, l'historique se met à jour tout seul.
  useEffect(() => {
    if (!history.data?.some((s) => s.status === 'running' || s.status === 'queued')) return
    const id = window.setInterval(() => void api.reloadZone(zone).then(refresh), 4000)
    return () => window.clearInterval(id)
  }, [history.data, zone])

  if (history.error) return <div className="page"><ErrorBlock message={history.error} onRetry={refresh} /></div>
  if (!history.data) return <div className="page"><LoadingBlock /></div>

  return (
    <div className="page">
      <PageHeader title={t('scan.title')} subtitle={t('scan.subtitle')} />

      <div className="stack">
        <Card title={t('scan.launchTitle')}>
          <p className="muted">{t('scan.launchHint')}</p>
          <div className="row" style={{ marginTop: 12 }}>
            {progress ? (
              <ScanProgress done={progress.done} total={progress.total} />
            ) : (
              <button className="btn btn-primary" onClick={ask} disabled={running}>
                {running ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" />} {running ? t('scan.running') : t('scan.run')}
              </button>
            )}
          </div>
        </Card>

        <Card title={t('scan.history')} flush>
          {history.data.length === 0 ? (
            <Empty title={t('scan.none')} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('scan.col.date')}</th>
                    <th scope="col">{t('scan.col.type')}</th>
                    <th scope="col" className="num">{t('scan.col.pages')}</th>
                    <th scope="col" className="num">{t('scan.col.products')}</th>
                    <th scope="col" className="num">{t('scan.col.credits')}</th>
                    <th scope="col">{t('scan.col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((s) => {
                    const skipped = s.skipped
                    const ok = Math.max(0, s.done - s.failed - skipped)
                    const why = reason(s.error)
                    return (
                      <tr key={s.id}>
                        <td className="strong">
                          {formatDateTime(s.finishedAt ?? s.createdAt)}
                          {s.by && <div className="small muted">{s.by}</div>}
                        </td>
                        <td>{t(s.trigger === 'manual' ? 'scan.manual' : 'scan.scheduled')}</td>
                        <td className="num">
                          {ok} / {s.total}
                          {(s.failed > 0 || skipped > 0) && (
                            <div className="small muted">
                              {[
                                s.failed > 0 && t('scan.failedN', { n: s.failed }),
                                skipped - s.skippedRecent > 0 && t('scan.skippedN', { n: skipped - s.skippedRecent }),
                                s.skippedRecent > 0 && t('scan.skippedRecentN', { n: s.skippedRecent }),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="num">{s.seen}</td>
                        <td className="num">
                          {s.credits}
                          {s.cost != null && s.cost > 0 && <div className="small muted">{formatMoney(s.cost, 'USD')}</div>}
                        </td>
                        <td>
                          <Pill tone={TONE[s.status]}>{t(`scan.status.${s.status}` as const)}</Pill>
                          {why && <div className="small muted">{why}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {confirm}
    </div>
  )
}
