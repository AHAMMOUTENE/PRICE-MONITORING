import { savePreferences } from '../lib/prefs'
import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import { useT, type TKey } from '../lib/i18n'
import { navigate, useRoute } from '../lib/router'
import { api } from '../api'
import { useZone } from '../lib/app'
import type { Zone } from '../types'

const TOUR_KEY = 'pm.tourDone'

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === '1'
  } catch {
    return false
  }
}

interface Step {
  icon: IconName
  title: TKey
  text: TKey
  /** Page à ouvrir pour cette étape ; une fonction quand elle dépend des données (ex. la fiche d'un compte). */
  route?: string | ((zone: Zone) => Promise<string>)
  /** Élément à mettre en lumière (`data-tour="…"`) ; sans cible, l'étape est une carte centrée. */
  target?: string
}

/**
 * Le parcours, dans l'ordre où l'équipe l'utilisera. À chaque étape, l'interface reste utilisable :
 * l'élément éclairé est cliquable, le reste est assombri.
 */
const STEPS: Step[] = [
  { icon: 'globe', title: 'tour.welcome.title', text: 'tour.welcome.text' },
  { icon: 'globe', title: 'tour.zone.title', text: 'tour.zone.text', route: '/', target: 'zone' },
  { icon: 'store', title: 'tour.accounts.title', text: 'tour.accounts.text', route: '/reglages/comptes', target: 'import-accounts' },
  { icon: 'box', title: 'tour.catalog.title', text: 'tour.catalog.text', route: '/reglages/produits', target: 'import-catalog' },
  { icon: 'edit', title: 'tour.catalogEdit.title', text: 'tour.catalogEdit.text', route: '/reglages/produits', target: 'catalog-table' },
  { icon: 'calendar', title: 'tour.calendar.title', text: 'tour.calendar.text', route: '/reglages/calendrier', target: 'calendar-form' },
  { icon: 'grid', title: 'tour.dashboard.title', text: 'tour.dashboard.text', route: '/', target: 'dash-top' },
  { icon: 'bell', title: 'tour.notifications.title', text: 'tour.notifications.text', route: '/', target: 'nav-notifications' },
  { icon: 'comment', title: 'tour.accountsList.title', text: 'tour.accountsList.text', route: '/comptes', target: 'accounts-table' },
  { icon: 'comment', title: 'tour.comments.title', text: 'tour.comments.text', route: accountWithIssues, target: 'comments' },
  { icon: 'help', title: 'tour.toIdentify.title', text: 'tour.toIdentify.text', route: accountWithIssues, target: 'to-identify' },
  { icon: 'checkCircle', title: 'tour.identify.title', text: 'tour.identify.text', route: '/identifier', target: 'identify-card' },
  { icon: 'download', title: 'tour.export.title', text: 'tour.export.text', route: '/', target: 'export' },
  { icon: 'checkCircle', title: 'tour.end.title', text: 'tour.end.text' },
]

/** La fiche d'un compte qui a des produits à identifier (sinon en anomalie, sinon le premier), pour montrer les commentaires et la validation. */
async function accountWithIssues(zone: Zone): Promise<string> {
  const week = await api.getWeek(zone)
  const pick = week.retailers.find((r) => r.toReview > 0) ?? week.retailers.find((r) => r.status === 'anomaly') ?? week.retailers[0]
  return pick ? `/comptes/${encodeURIComponent(pick.retailer.id)}` : '/comptes'
}

const PAD = 8

/**
 * Tutoriel interactif de première connexion : une bulle à côté de l'élément concerné, la page qu'il faut
 * ouverte au bon moment, et l'élément éclairé reste manipulable (changer de zone, cliquer un compte…).
 * On peut le passer à tout moment ; il ne revient pas, sauf depuis « Revoir le tutoriel ».
 */
export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT()
  const { path } = useRoute()
  const { zone } = useZone()
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = STEPS[i]

  useEffect(() => {
    if (open) setI(0)
  }, [open])

  // Ouvre la page de l'étape si besoin.
  useEffect(() => {
    if (!open || !step.route) return
    let alive = true
    const go = (to: string) => alive && path !== to && navigate(to)
    if (typeof step.route === 'string') go(step.route)
    else step.route(zone).then(go)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i])

  // Cherche la cible (elle peut arriver après le chargement des données), la fait défiler en vue et suit sa position.
  useLayoutEffect(() => {
    if (!open || !step.target) {
      setRect(null)
      return
    }
    let el: Element | null = null
    let tries = 0
    let raf = 0
    let timer = 0
    const measure = () => {
      if (!el) return
      setRect(el.getBoundingClientRect())
    }
    const find = () => {
      el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        measure()
        timer = window.setInterval(measure, 250) // suit l'élément pendant le défilement et les rechargements
      } else if (tries++ < 40) {
        raf = window.setTimeout(find, 100) as unknown as number
      } else {
        setRect(null)
      }
    }
    find()
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(raf)
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i, path])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      // Les flèches ne changent pas d'étape quand on saisit du texte ou qu'on choisit dans une liste.
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, STEPS.length - 1))
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const finish = () => {
    try {
      localStorage.setItem(TOUR_KEY, '1')
      savePreferences({ tourDone: true })
    } catch {
      /* non mémorisé : le tutoriel reviendra */
    }
    onClose()
  }
  if (!open) return null

  const last = i === STEPS.length - 1
  const vw = window.innerWidth
  const vh = window.innerHeight
  const hole = rect ? { top: Math.max(0, rect.top - PAD), left: Math.max(0, rect.left - PAD), width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null

  // La bulle se place sous la cible, sinon au-dessus, sinon à droite ; toujours dans l'écran.
  let bubble: { top: number; left: number } | null = null
  if (hole) {
    const W = Math.min(400, vw - 24)
    const H = 260
    let top = hole.top + hole.height + 12
    let left = hole.left
    if (top + H > vh) top = hole.top - H - 12
    if (top < 8) {
      top = Math.max(8, Math.min(hole.top, vh - H - 8))
      left = hole.left + hole.width + 12
    }
    left = Math.max(12, Math.min(left, vw - W - 12))
    bubble = { top, left }
  }

  const card = (
    <div className={`tour${hole ? ' is-bubble' : ''}`} style={bubble ? { position: 'fixed', top: bubble.top, left: bubble.left } : undefined}>
      <button className="tour-skip linkbtn" onClick={finish}>
        {t('tour.skip')}
      </button>
      <span className="tour-icon">
        <Icon name={step.icon} />
      </span>
      <p className="tour-step">{t('tour.stepOf', { n: i + 1, total: STEPS.length })}</p>
      <h2 id="tour-title">{t(step.title)}</h2>
      <p className="tour-text">{t(step.text)}</p>
      {step.target && !hole && <p className="small muted">{t('tour.notHere')}</p>}
      <div className="tour-foot">
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((_, k) => (
            <button key={k} className={k === i ? 'is-on' : ''} onClick={() => setI(k)} tabIndex={-1} />
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {i > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setI(i - 1)}>
              {t('tour.prev')}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => (last ? finish() : setI(i + 1))}>
            {last ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  )

  // Rendu hors de la grille de l'application (portail), pour ne pas prendre la place du contenu.
  if (!hole) {
    return createPortal(
      <div className="tour-scrim" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        {card}
      </div>,
      document.body,
    )
  }
  // Quatre panneaux assombris autour de la cible : la cible elle-même reste cliquable.
  return createPortal(
    <div role="dialog" aria-labelledby="tour-title">
      <div className="tour-dim" style={{ top: 0, left: 0, width: vw, height: hole.top }} />
      <div className="tour-dim" style={{ top: hole.top + hole.height, left: 0, width: vw, height: Math.max(0, vh - hole.top - hole.height) }} />
      <div className="tour-dim" style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }} />
      <div className="tour-dim" style={{ top: hole.top, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width), height: hole.height }} />
      <div className="tour-ring" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
      {card}
    </div>,
    document.body,
  )
}
