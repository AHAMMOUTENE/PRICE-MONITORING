import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Icon } from './Icon'
import { useToast } from './toast'
import { useZone } from '../lib/app'
import { formatShortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { downloadWorkbook } from '../lib/xlsx-export'

/**
 * Bouton d'export Excel avec deux choix : la semaine affichée, ou tout l'historique.
 * `weeks` : toutes les semaines disponibles, la plus récente en premier.
 */
export function ExportMenu({ weekOf, weeks }: { weekOf: string; weeks: string[] }) {
  const { t } = useT()
  const { zone } = useZone()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
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

  const run = async (fromWeek: string, toWeek: string) => {
    setOpen(false)
    setBusy(true)
    try {
      await downloadWorkbook(await api.buildExport(zone, { fromWeek, toWeek, retailerIds: [], proof: 'all' }))
      toast.show(t('common.exported'))
    } finally {
      setBusy(false)
    }
  }

  const oldest = weeks[weeks.length - 1] ?? weekOf
  const newest = weeks[0] ?? weekOf

  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-primary" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)}>
        <Icon name="download" /> {busy ? t('common.exporting') : t('common.export')}
        <Icon name="chevronDown" className="icon menu-chev" />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button role="menuitem" className="menu-item" onClick={() => run(weekOf, weekOf)}>
            <b>{t('export.thisWeek', { date: formatShortDate(weekOf) })}</b>
          </button>
          <button role="menuitem" className="menu-item" onClick={() => run(oldest, newest)}>
            <b>{t('export.all')}</b>
            <span>{t('count.week', { n: weeks.length })}</span>
          </button>
        </div>
      )}
    </div>
  )
}
