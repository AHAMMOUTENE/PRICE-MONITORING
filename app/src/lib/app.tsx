import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Zone } from '../types'
import { DEFAULT_ZONE, isZone } from './zones'

/* Zone courante -------------------------------------------------------- */

/** Ce que le sélecteur propose : une zone de données, ou la vue globale (lecture seule, toutes zones). */
export type ZoneView = Zone | 'GLOBAL'

interface AppState {
  /** Zone de données courante (quand la vue globale est choisie : la dernière zone visitée). */
  zone: Zone
  /** Ce que l'utilisateur a choisi dans le sélecteur. */
  view: ZoneView
  setZone: (v: ZoneView) => void
}

const AppContext = createContext<AppState>({ zone: DEFAULT_ZONE, view: DEFAULT_ZONE, setZone: () => undefined })

function readView(): ZoneView {
  try {
    const saved = localStorage.getItem('pm.zone')
    if (saved === 'GLOBAL') return 'GLOBAL'
    return isZone(saved) ? saved : DEFAULT_ZONE // une ancienne valeur (ex. « EUR ») retombe sur la zone par défaut
  } catch {
    return DEFAULT_ZONE
  }
}
function readLastZone(): Zone {
  try {
    const saved = localStorage.getItem('pm.lastZone')
    return isZone(saved) ? saved : DEFAULT_ZONE
  } catch {
    return DEFAULT_ZONE
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ZoneView>(readView)
  const [zone, setLastZone] = useState<Zone>(() => (view === 'GLOBAL' ? readLastZone() : (view as Zone)))
  const setZone = (v: ZoneView) => {
    setView(v)
    if (v !== 'GLOBAL') setLastZone(v)
    try {
      localStorage.setItem('pm.zone', v)
      if (v !== 'GLOBAL') localStorage.setItem('pm.lastZone', v)
    } catch {
      /* stockage indisponible : la zone n'est simplement pas mémorisée */
    }
  }
  return <AppContext.Provider value={{ zone, view, setZone }}>{children}</AppContext.Provider>
}

export function useZone(): AppState {
  return useContext(AppContext)
}

/* Rafraîchissement des données après une modification ------------------ */

let version = 0
const listeners = new Set<() => void>()

export function refresh(): void {
  version++
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export interface Query<T> {
  data?: T
  loading: boolean
  error?: string
}

/** Charge des données et les recharge quand `refresh()` est appelé ou que `deps` change. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): Query<T> {
  const v = useSyncExternalStore(subscribe, () => version)
  const [state, setState] = useState<Query<T>>({ loading: true })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: undefined }))
    fn()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e: unknown) => alive && setState({ loading: false, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ...deps])
  return state
}

/* Largeur d'écran ------------------------------------------------------ */

export function useMediaQuery(query: string): boolean {
  const mql = typeof window !== 'undefined' ? window.matchMedia(query) : null
  return useSyncExternalStore(
    (cb) => {
      mql?.addEventListener('change', cb)
      return () => mql?.removeEventListener('change', cb)
    },
    () => mql?.matches ?? false,
    () => false,
  )
}
