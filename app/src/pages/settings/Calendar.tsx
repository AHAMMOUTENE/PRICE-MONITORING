import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { countScanDays } from '../../api/schedule'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/toast'
import { Card, Drawer, ErrorBlock, LoadingBlock, PageHeader } from '../../components/ui'
import { refresh, useQuery, useZone } from '../../lib/app'
import { formatFullDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { SalePeriod, ScanEstimate, ScanPlan, Zone } from '../../types'

const DAYS = [1, 2, 3, 4, 5, 6, 7]
/** Lundi et jeudi : deux scans par semaine, le rythme proposé par défaut pendant les soldes. */
const DEFAULT_DAYS = [1, 4]

/** Nom du jour (1 = lundi … 7 = dimanche) dans la langue de l'interface. */
function dayName(locale: string, day: number): string {
  const monday = Date.UTC(2026, 10, 16) // un lundi
  const s = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(monday + (day - 1) * 86_400_000))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Formulaire d'une période de soldes : le même pour l'ajout (dans la page) et la modification (dans un volet).
 * Le bouton principal reste gris tant que le formulaire est incomplet.
 */
function PeriodForm({ zone, initial, onDone }: { zone: Zone; initial?: SalePeriod; onDone: () => void }) {
  const { t, locale } = useT()
  const toast = useToast()
  const [label, setLabel] = useState(initial?.label ?? '')
  const [start, setStart] = useState(initial?.start ?? '')
  const [end, setEnd] = useState(initial?.end ?? '')
  const [mode, setMode] = useState<ScanPlan['mode']>(initial?.scan.mode ?? 'weekly')
  const [days, setDays] = useState<number[]>(initial?.scan.mode === 'weekly' ? initial.scan.days : DEFAULT_DAYS)
  const [busy, setBusy] = useState(false)
  const [estimate, setEstimate] = useState<ScanEstimate | null>(null)

  const plan = useMemo<ScanPlan>(() => (mode === 'daily' ? { mode: 'daily' } : { mode: 'weekly', days }), [mode, days])
  const datesOk = Boolean(start && end && end >= start)

  useEffect(() => {
    if (!datesOk) {
      setEstimate(null)
      return
    }
    let alive = true
    api.estimateScans(zone, start, end, plan).then((e) => alive && setEstimate(e))
    return () => {
      alive = false
    }
  }, [zone, start, end, plan, datesOk])

  const error = !label.trim()
    ? t('sales.errName')
    : !start || !end
      ? t('sales.errDates')
      : end < start
        ? t('sales.errOrder')
        : plan.mode === 'weekly' && plan.days.length === 0
          ? t('sales.errDays')
          : ''

  const submit = async () => {
    if (error || busy) return
    setBusy(true)
    try {
      const period = { label: label.trim(), start, end, scan: plan }
      if (initial) {
        await api.updateSalePeriod(initial.id, period)
        toast.show(t('sales.updated'))
      } else {
        await api.addSalePeriod({ zone, ...period })
        toast.show(t('sales.added'))
      }
      refresh()
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)))

  return (
    <>
      <div className="row">
        <input className="input" style={{ width: 240 }} placeholder={t('sales.name')} aria-label={t('sales.name')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input" style={{ width: 170 }} type="date" aria-label={t('sales.start')} value={start} onChange={(e) => setStart(e.target.value)} />
        <input className="input" style={{ width: 170 }} type="date" aria-label={t('sales.end')} min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <span className="label">{t('sales.scanTitle')}</span>
        <div className="seg seg-lg" role="group" aria-label={t('sales.scanTitle')}>
          <button type="button" aria-pressed={mode === 'weekly'} onClick={() => setMode('weekly')}>
            {t('sales.scanWeekly')}
          </button>
          <button type="button" aria-pressed={mode === 'daily'} onClick={() => setMode('daily')}>
            {t('sales.scanDaily')} <em>{t('sales.costly')}</em>
          </button>
        </div>
        {mode === 'weekly' && (
          <div className="daypick" role="group" aria-label={t('sales.scanWeekly')}>
            {DAYS.map((d) => (
              <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>
                {dayName(locale, d)}
              </button>
            ))}
          </div>
        )}
        <p className="preview-box" aria-live="polite">
          {estimate && t('sales.estimate', { scans: t('count.scan', { n: estimate.scans }), visits: t('count.visit', { n: estimate.visits }) })}
          {mode === 'daily' && ` ${t('sales.estimateDaily')}`}
        </p>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={submit} disabled={busy || Boolean(error)}>
          {initial ? t('common.save') : <><Icon name="plus" /> {t('common.add')}</>}
        </button>
        {initial && (
          <button className="btn btn-ghost" onClick={onDone}>
            {t('common.cancel')}
          </button>
        )}
        {(initial || label || start || end) && error && (
          <span className="error-text" role="alert">
            {error}
          </span>
        )}
      </div>
    </>
  )
}

/**
 * Calendrier des soldes de la zone. Hors période, un scan a lieu chaque lundi ;
 * pour chaque période, l'équipe choisit les jours de scan, ou un scan quotidien (coûteux).
 * L'ajout se fait dans la page ; la modification s'ouvre dans un volet, sans quitter la liste.
 */
export function CalendarSettings() {
  const { t, locale } = useT()
  const { zone } = useZone()
  const toast = useToast()
  const list = useQuery(() => api.listSalePeriods(zone), [zone])
  const [editing, setEditing] = useState<SalePeriod | null>(null)

  if (list.error) return <div className="page"><ErrorBlock message={list.error} onRetry={refresh} /></div>
  if (!list.data) return <div className="page"><LoadingBlock /></div>

  const remove = async (p: SalePeriod) => {
    await api.removeSalePeriod(p.id)
    if (editing?.id === p.id) setEditing(null)
    refresh()
    toast.show(t('sales.deleted', { name: p.label }))
  }

  const planSummary = (p: ScanPlan) => (p.mode === 'daily' ? t('sales.everyDay') : p.days.map((d) => dayName(locale, d)).join(' · '))

  return (
    <div className="page page-narrow">
      <PageHeader title={t('calendar.title')} subtitle={`${t('calendar.subtitle')} ${t('calendar.default')}`} />

      <div className="stack">
        <div data-tour="calendar-form">
          <Card title={t('calendar.add')}>
            <PeriodForm zone={zone} onDone={() => undefined} key={list.data.length} />
          </Card>
        </div>

        <Card title={t('calendar.list')} flush>
          {list.data.length === 0 ? (
            <p className="card-empty">{t('sales.none')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('calendar.colName')}</th>
                  <th scope="col">{t('sales.start')}</th>
                  <th scope="col">{t('sales.end')}</th>
                  <th scope="col">{t('calendar.colScans')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td className="strong">{p.label}</td>
                    <td>{formatFullDate(p.start)}</td>
                    <td>{formatFullDate(p.end)}</td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <span>{planSummary(p.scan)}</span>
                        {p.scan.mode === 'daily' && <span className="pill pill-warn">{t('sales.costly')}</span>}
                        <span className="muted small">{t('count.scan', { n: countScanDays(p.start, p.end, p.scan) })}</span>
                      </span>
                    </td>
                    <td className="num">
                      <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <button className="iconbtn" onClick={() => setEditing(p)} aria-label={t('sales.edit', { name: p.label })} title={t('sales.edit', { name: p.label })}>
                          <Icon name="edit" />
                        </button>
                        <button className="iconbtn" onClick={() => remove(p)} aria-label={t('sales.delete', { name: p.label })} title={t('sales.delete', { name: p.label })}>
                          <Icon name="trash" />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {editing && (
        <Drawer title={t('calendar.edit', { name: editing.label })} onClose={() => setEditing(null)}>
          <PeriodForm zone={zone} initial={editing} onDone={() => setEditing(null)} />
        </Drawer>
      )}
    </div>
  )
}
