import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { ApiError } from '../api/http'
import { refresh, useQuery, useZone } from '../lib/app'
import { formatDateTime } from '../lib/format'
import { useT, type TKey } from '../lib/i18n'
import type { WeekOverview } from '../types'
import { Icon } from './Icon'
import { useToast } from './toast'

/** Lance un scan réel et suit son avancement ; les erreurs (limites de coût, clé absente…) sont expliquées en une phrase. */
export function useScanRunner() {
  const { t } = useT()
  const { zone } = useZone()
  const toast = useToast()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [asking, setAsking] = useState(false)

  const start = async (options?: { force?: boolean }) => {
    setProgress({ done: 0, total: 0 })
    try {
      await api.startScan(zone, (done, total) => setProgress({ done, total }), options)
      toast.show(t('scan.done'))
    } catch (e) {
      const key = `scan.err.${e instanceof ApiError ? e.code : 'other'}` as TKey
      const text = t(key)
      toast.show(text === key ? t('scan.err.other') : text)
    } finally {
      setProgress(null)
      refresh()
    }
  }
  /** À afficher par l'écran qui lance le scan : la fenêtre de confirmation. */
  const confirm: ReactNode = asking ? (
    <ScanConfirm
      onCancel={() => setAsking(false)}
      onConfirm={(force) => {
        setAsking(false)
        void start({ force })
      }}
    />
  ) : null
  return { progress, start, ask: () => setAsking(true), confirm }
}

/**
 * Un scan visite les pages de tous les retailers suivis de la zone, pour tout le monde, et consomme des crédits :
 * on le dit, et on demande confirmation.
 */
function ScanConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (force: boolean) => void }) {
  const { t } = useT()
  const { zone } = useZone()
  const preview = useQuery(() => api.previewScan(zone), [zone])
  const [force, setForce] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  const p = preview.data
  const pages = p ? p.toVisit + (force ? p.recent : 0) : 0
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={t('scan.confirmTitle', { zone })}>
        <h2>{t('scan.confirmTitle', { zone })}</h2>
        {p && (
          <>
            <p className="muted">{pages > 0 ? t('scan.confirmPages', { n: pages }) : t('scan.nothingToVisit')}</p>
            {p.recent > 0 && (
              <label className="opt">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>
                  {t('scan.confirmForce', { n: p.recent })}
                  <small className="muted"> {t('scan.confirmRecent', { h: p.hours })}</small>
                </span>
              </label>
            )}
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => onConfirm(force)} disabled={!p || pages === 0} autoFocus>
            <Icon name="refresh" /> {t('scan.run')}
          </button>
        </div>
      </div>
    </>
  )
}

/** Avancement d'un scan : barre et « 12 / 40 pages ». */
export function ScanProgress({ done, total }: { done: number; total: number }) {
  const { t } = useT()
  return (
    <span className="scanbtn-progress">
      <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t('scan.running')}>
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </span>
      <span className="small muted">{total ? t('scan.progress', { done, total }) : t('scan.running')}</span>
    </span>
  )
}

/**
 * Tableau de bord : date et heure du dernier scan de la zone, sans bouton de lancement.
 * Chaque zone lance ses scans à la main depuis la rubrique « Scanner » (un clic ouvre cette page).
 * Pendant un scan, la boîte montre l'avancement, même s'il a été lancé ailleurs ou par le planificateur.
 */
export function LastScan({ lastScan }: { lastScan?: WeekOverview['lastScan'] }) {
  const { t } = useT()
  const { zone } = useZone()
  const running = Boolean(lastScan?.running)
  const [remote, setRemote] = useState<{ done: number; total: number } | null>(null)

  // Un scan en cours : on suit son avancement, puis on relit l'état de la zone à sa fin.
  useEffect(() => {
    if (!running) {
      setRemote(null)
      return
    }
    let alive = true
    const tick = async () => {
      const list = await api.listScans(zone).catch(() => [])
      if (!alive) return
      const run = list.find((x) => x.status === 'running' || x.status === 'queued')
      if (run) setRemote({ done: run.done, total: run.total })
      else {
        setRemote(null)
        await api.reloadZone(zone)
        if (alive) refresh()
      }
    }
    void tick()
    const id = window.setInterval(tick, 4000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [running, zone])

  return (
    <a className={`scanbox is-link${running ? ' is-running' : ''}`} href="#/scanner" data-tour="scan" title={t('scan.title')}>
      {running ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {remote ? <ScanProgress done={remote.done} total={remote.total} /> : <span className="small muted">{t('scan.running')}</span>}
        </>
      ) : (
        <>
          <span className="scanbox-label">
            <Icon name="clock" /> {t('scan.last')}
          </span>
          <span className="scanbox-last">{lastScan?.at ? formatDateTime(lastScan.at) : t('scan.never')}</span>
        </>
      )}
    </a>
  )
}
