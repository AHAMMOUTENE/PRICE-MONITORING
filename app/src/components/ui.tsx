import { useEffect, useRef, useState, type ReactNode } from 'react'
import { vejaThumbnail } from '../lib/images'
import { formatDiscount, formatShortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import type { AccountComment } from '../types'
import { Icon, type IconName } from './Icon'

/** Palette des séries et des logos de comptes. */
export const SERIES_COLORS = ['#0aa5e0', '#0a3a72', '#f5b82e', '#7a4fd0', '#119e9a', '#e0568c', '#0e5a41', '#d4623a', '#5b6b7a', '#8aa63a']

const SWATCHES: [RegExp, string, string][] = [
  [/black/i, '#1d2023', '#fff'],
  [/white/i, '#f2f2ee', '#14181b'],
  [/kaki|khaki|olive|absinthe/i, '#7b7a45', '#fff'],
  [/cognac|tent|liquor|ocre|clay|bark|mulberry/i, '#a85f33', '#fff'],
  [/jade|aqua|indigo|blue|bleu/i, '#4f86a0', '#fff'],
  [/pierre|natural|sand|sable|camel|dune|ecru|cashew/i, '#d9d0bd', '#14181b'],
  [/rose|amarante|poker/i, '#c9577a', '#fff'],
]

/** Pastille de couleur de remplacement tant qu'un produit n'a pas d'image. */
export function Thumb({ color, label, size = 36 }: { color: string; label: string; size?: number }) {
  const match = SWATCHES.find(([re]) => re.test(color))
  const initials = label
    .replace(/^veja\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span className="thumb" style={{ background: match?.[1] ?? '#cfd3d0', color: match?.[2] ?? '#14181b', width: size, height: size, fontSize: Math.max(10, size / 3.4) }} aria-hidden="true">
      {initials}
    </span>
  )
}

/** Image d'un produit : celle du revendeur si on l'a, sinon la vignette VEJA, sinon une pastille de couleur. */
export function ProductImage({ src, sku, color, label, size = 56 }: { src?: string; sku?: string; color: string; label: string; size?: number }) {
  const url = src ?? (sku ? vejaThumbnail(sku) : undefined)
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <Thumb color={color} label={label} size={size} />
  return <img className="pimg" src={url} alt="" loading="lazy" width={size} height={size} style={{ width: size, height: size }} onError={() => setFailed(true)} />
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Pastille d'un compte : ses initiales sur une couleur propre, en attendant les logos. */
export function AccountLogo({ name, size = 40 }: { name: string; size?: number }) {
  const color = SERIES_COLORS[hash(name) % SERIES_COLORS.length]
  const initials = name
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span className="logo" style={{ width: size, height: size, color, background: `${color}1f`, fontSize: size / 2.6 }} aria-hidden="true">
      {initials}
    </span>
  )
}

export type Tone = 'ok' | 'danger' | 'warn' | 'neutral' | 'info'

export function Pill({ tone = 'neutral', icon, title, children }: { tone?: Tone; icon?: IconName; title?: string; children: ReactNode }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  )
}

/**
 * Remise par rapport au prix de référence.
 * Rouge quand c'est une anomalie, gris quand la remise est autorisée, vert « conforme » sans remise.
 */
export function DiscountPill({ pct, anomaly }: { pct: number; anomaly?: boolean }) {
  const { t } = useT()
  const isAnomaly = anomaly ?? pct >= 1
  return pct >= 1 ? (
    <span className={`pill ${isAnomaly ? 'pill-danger' : 'pill-neutral'} pill-lg`}>
      <Icon name="arrowDown" />
      {formatDiscount(pct)}
    </span>
  ) : (
    <span className="pill pill-ok pill-lg">
      <Icon name="check" />
      {t('status.compliant')}
    </span>
  )
}

/** Dernier commentaire laissé sur un compte, en une ligne ; le texte complet, l'auteur et la date au survol. */
export function CommentCell({ comment }: { comment?: AccountComment }) {
  if (!comment) return <span className="muted">—</span>
  return (
    <span className="comment-cell" title={`${comment.by} · ${formatShortDate(comment.at.slice(0, 10))}\n${comment.text}`}>
      <Icon name="comment" className="icon muted" />
      <span>{comment.text}</span>
    </span>
  )
}

/* Conteneurs ------------------------------------------------------------ */

export function Card({ title, action, children, flush = false, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      <div className={flush ? 'card-body is-flush' : 'card-body'}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, subtitle, back, actions, lead }: { title: ReactNode; subtitle?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode; lead?: ReactNode }) {
  return (
    <header className="page-head">
      {back && (
        <a className="back" href={back.href}>
          <Icon name="chevronLeft" /> {back.label}
        </a>
      )}
      <div className="page-head-row">
        {lead}
        <div className="page-head-title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  )
}

export function KpiCard({ label, value, hint, tone, icon, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'warn' | 'ok'; icon: IconName; href?: string }) {
  const body = (
    <>
      <span className={`kpi-icon${tone ? ` tone-${tone}` : ''}`}>
        <Icon name={icon} />
      </span>
      <span className="kpi-text">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{value}</span>
        {hint && <span className="kpi-hint">{hint}</span>}
      </span>
    </>
  )
  return href ? (
    <a className="kpi" href={href}>
      {body}
      <Icon name="chevronRight" className="icon kpi-go" />
    </a>
  ) : (
    <div className="kpi">{body}</div>
  )
}

/* États ----------------------------------------------------------------- */

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />
}

export function LoadingBlock() {
  const { t } = useT()
  return (
    <div role="status" aria-live="polite" className="stack-sm" style={{ padding: 'var(--s4) 0' }}>
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton height={22} width="40%" />
      <Skeleton height={14} width="25%" />
      <Skeleton height={120} />
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useT()
  return (
    <Empty
      title={t('common.errorTitle')}
      action={
        onRetry && (
          <button className="btn btn-secondary" onClick={onRetry}>
            <Icon name="refresh" /> {t('common.retry')}
          </button>
        )
      }
    >
      {message}
    </Empty>
  )
}

/** Panneau latéral : Échap ferme, le focus entre dans le panneau et revient à l'ouverture. */
export function Drawer({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="muted small">{subtitle}</div>}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  )
}
