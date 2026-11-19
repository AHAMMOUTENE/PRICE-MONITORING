import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { formatShortDate } from '../lib/format'
import { useT } from '../lib/i18n'

export interface WeekStat {
  week: string
  confirmed: number
}

/**
 * Sélecteur de semaine : un bouton avec une icône calendrier, qui ouvre la liste des semaines.
 * Chaque semaine montre une barre proportionnelle au nombre d'anomalies.
 */
export function WeekPicker({ stats, value, onChange }: { stats: WeekStat[]; value: string; onChange: (week: string) => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const max = Math.max(1, ...stats.map((s) => s.confirmed))
  const latest = stats[0]?.week

  return (
    <div className="weekpick" ref={ref}>
      <button className="weekpick-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" />
        <span>{t('common.week', { date: formatShortDate(value) })}</span>
        {value === latest && <span className="weekpick-tag">{t('common.current')}</span>}
        <Icon name="chevronDown" className="icon weekpick-chev" />
      </button>
      {open && (
        <div className="weekpick-pop" role="listbox" aria-label={t('picker.aria')}>
          <div className="weekpick-head" aria-hidden="true">
            <span>{t('weekpick.week')}</span>
            <span />
            <span>{t('weekpick.anomalies')}</span>
          </div>
          {stats.map((s) => (
            <button
              key={s.week}
              role="option"
              aria-selected={s.week === value}
              className={`weekpick-opt${s.week === value ? ' is-selected' : ''}`}
              onClick={() => {
                onChange(s.week)
                setOpen(false)
              }}
            >
              <span className="wk-label">
                {formatShortDate(s.week)}
                {s.week === latest && <small>{t('common.current')}</small>}
              </span>
              <span className="wk-bar" aria-hidden="true">
                <i style={{ width: `${(s.confirmed / max) * 100}%` }} />
              </span>
              <span className="wk-n">{s.confirmed}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
