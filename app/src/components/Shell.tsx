import { useState, type ReactNode } from 'react'
import { api } from '../api'
import { useQuery, useZone } from '../lib/app'
import type { Locale } from '../lib/format'
import { LANGUAGES, useT } from '../lib/i18n'
import { useRoute } from '../lib/router'
import { ZONES } from '../lib/zones'
import { Icon, type IconName } from './Icon'
import { makeRequest } from '../api/http'
import { Global } from '../pages/Global'
import { Tour, tourSeen } from './Tour'
import type { ZoneView } from '../lib/app'

/** Logo officiel, servi par le serveur d'images de VEJA. */
const VEJA_LOGO = 'https://media.veja-store.com/image/upload/v1694534613/VEJA/LOGOS/VEJA-BLACK-LOGO-TEXT.png'

const ACTIONABLE = new Set(['review', 'recurrence'])
const SIDE_KEY = 'pm.side'

interface Item {
  href: string
  label: string
  icon: IconName
  current: boolean
  badge?: number
  tour?: string
  /** Sous-pages, visibles sous l'entrée quand elle est active ou ouverte. */
  children?: { href: string; label: string; current: boolean }[]
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useT()
  const { path } = useRoute()
  const { zone, view, setZone } = useZone()
  const global = view === 'GLOBAL' // vue globale : lecture seule, toutes zones, une seule page
  const [open, setOpen] = useState(false) // menu mobile (tiroir)
  const [tour, setTour] = useState(() => !tourSeen()) // tutoriel de première connexion
  const [collapsed, setCollapsed] = useState(readCollapsed) // menu réduit à ses icônes, grand écran
  const alerts = useQuery(() => api.listAlerts(zone), [zone])
  const user = useQuery(() => api.getCurrentUser(), [])
  const count = (alerts.data ?? []).filter((a) => ACTIONABLE.has(a.kind)).length

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDE_KEY, c ? 'open' : 'collapsed')
      } catch {
        /* le choix n'est simplement pas mémorisé */
      }
      return !c
    })

  const top: Item[] = [
    { href: '/', label: t('nav.dashboard'), icon: 'grid', current: path === '/' },
    { href: '/notifications', label: t('nav.notifications'), icon: 'bell', current: path === '/notifications', badge: count, tour: 'nav-notifications' },
  ]
  // Une entrée par famille de pages ; les sous-pages sont des onglets en haut de la page.
  const main: Item[] = [
    {
      href: '/comptes',
      label: t('nav.accounts'),
      icon: 'store',
      current: path.startsWith('/comptes') || path === '/reglages/comptes',
      children: [
        { href: '/comptes', label: t('tab.tracking'), current: path.startsWith('/comptes') },
        { href: '/reglages/comptes', label: t('nav.manageAccounts'), current: path === '/reglages/comptes' },
      ],
    },
    {
      href: '/produits',
      label: t('nav.products'),
      icon: 'box',
      current: path.startsWith('/produits') || path === '/reglages/produits',
      children: [
        { href: '/produits', label: t('tab.tracking'), current: path.startsWith('/produits') },
        { href: '/reglages/produits', label: t('nav.manageProducts'), current: path === '/reglages/produits' },
      ],
    },
    { href: '/scanner', label: t('nav.scan'), icon: 'refresh', current: path === '/scanner', tour: 'nav-scan' },
    { href: '/reglages/calendrier', label: t('nav.calendar'), icon: 'calendar', current: path === '/reglages/calendrier' },
  ]
  const bottom: Item[] = [{ href: '/historique', label: t('nav.history'), icon: 'file', current: path === '/historique' }]

  const [opened, setOpened] = useState('') // famille de pages dépliée par un clic (la famille active l'est toujours)
  const renderItems = (items: Item[]) =>
    items.map((i) => {
      const group = Boolean(i.children)
      const expanded = group && (i.current || opened === i.href)
      return (
        <div key={i.href} className={group ? 'side-fam' : undefined}>
          <a
            href={`#${i.href}`}
            className={`side-link${group ? ' is-group' : ''}`}
            data-tour={i.tour}
            aria-current={i.current ? 'page' : undefined}
            aria-expanded={group ? expanded : undefined}
            title={collapsed ? i.label : undefined}
            onClick={() => {
              if (group) setOpened(i.href)
              else setOpen(false)
            }}
          >
            <Icon name={i.icon} />
            <span>{i.label}</span>
            {i.badge ? (
              <span className="side-badge" aria-label={`${i.badge}`}>
                {i.badge}
              </span>
            ) : null}
            {group && <Icon name="chevronDown" className={`icon side-chev${expanded ? ' is-open' : ''}`} />}
          </a>
          {expanded && (
            <div className="side-children">
              {i.children!.map((c) => (
                <a key={c.href} href={`#${c.href}`} className="side-sublink" aria-current={c.current ? 'page' : undefined} onClick={() => setOpen(false)}>
                  {c.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )
    })

  const zoneLabel = global ? t('zone.GLOBAL') : zone
  const globalItem: Item[] = [{ href: '/', label: t('global.title'), icon: 'globe', current: true }]
  const langLabel = LANGUAGES.find((l) => l.id === locale)?.label ?? locale
  /** Déconnexion : c'est le SSO (Cloudflare Access) qui ferme la session, pas l'application. En local il n'y en a pas. */
  const logout = async () => {
    if (import.meta.env.DEV) {
      // SSO simulé : on ferme la session locale, puis la page de connexion s'affiche.
      await makeRequest(import.meta.env.VITE_API_URL || '/api')('POST', '/auth/logout').catch(() => undefined)
      window.location.reload()
    } else window.location.assign(import.meta.env.VITE_LOGOUT_URL || '/cdn-cgi/access/logout')
  }
  const toggleLabel = collapsed ? t('nav.expand') : t('nav.collapse')

  return (
    <div className={`app${collapsed ? ' is-collapsed' : ''}`}>
      <aside className={`side${open ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`} aria-label={t('nav.menu')}>
        <div className="side-top">
          <a className="brand" href="#/" onClick={() => setOpen(false)}>
            <img className="brand-logo" src={VEJA_LOGO} alt="VEJA" />
            <span>{t('app.name')}</span>
          </a>
          <button className="iconbtn side-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={toggleLabel} title={toggleLabel}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
          </button>
        </div>

        {collapsed ? (
          <button className="side-mini" onClick={toggleCollapsed} title={`${t('nav.zone')} : ${zoneLabel}`} aria-label={`${t('nav.zone')} : ${zoneLabel}`}>
            {global ? 'ALL' : zone}
          </button>
        ) : (
          <div className="side-block">
            <span className="side-title">{t('nav.zone')}</span>
            <label className="side-select" data-tour="zone">
              <select aria-label={t('nav.zone')} value={view} onChange={(e) => setZone(e.target.value as ZoneView)}>
                {ZONES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.id}
                  </option>
                ))}
                <option value="GLOBAL">{t('zone.GLOBAL')}</option>
              </select>
              <Icon name="chevronDown" className="icon side-select-chev" />
            </label>
          </div>
        )}

        <nav className="side-nav">
          <div className="side-group">{renderItems(global ? globalItem : [...top, ...main])}</div>
          {!global && <div className="side-group side-bottom">{renderItems(bottom)}</div>}
        </nav>

        <div className="side-foot">
          {user.data && (
            <div className="side-userbar">
            <div className="side-user" title={`${t('nav.signedIn')} ${user.data.name}`}>
              <span className="avatar" aria-hidden="true">
                {user.data.name
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <span className="side-user-text">
                <span className="k">{t('nav.signedIn')}</span>
                <span>{user.data.name}</span>
              </span>
            </div>
            <button className="iconbtn side-logout" onClick={logout} title={t('nav.logout')} aria-label={t('nav.logout')}>
              <Icon name="logout" />
            </button>
            </div>
          )}
          {collapsed ? (
            <button className="side-mini" onClick={toggleCollapsed} title={`${t('nav.language')} : ${langLabel}`} aria-label={`${t('nav.language')} : ${langLabel}`}>
              {locale.toUpperCase()}
            </button>
          ) : (
            <label className="side-select has-icon">
              <Icon name="globe" className="icon side-select-icon" />
              <select aria-label={t('nav.language')} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" className="icon side-select-chev" />
            </label>
          )}
          <button className="side-link side-help" onClick={() => setTour(true)} title={collapsed ? t('tour.replay') : undefined}>
            <Icon name="help" />
            <span>{t('tour.replay')}</span>
          </button>
        </div>
      </aside>
      <Tour open={tour} onClose={() => setTour(false)} />
      {open && <div className="side-scrim" onClick={() => setOpen(false)} />}

      <div className="content">
        <header className="mobilebar">
          <button className="iconbtn" onClick={() => setOpen(true)} aria-label={t('nav.menu')}>
            <Icon name="menu" />
          </button>
          <a className="brand" href="#/">
            <img className="brand-logo" src={VEJA_LOGO} alt="VEJA" />
            <span>{t('app.name')}</span>
          </a>
        </header>
        <main>{global ? <Global /> : children}</main>
      </div>
    </div>
  )
}
