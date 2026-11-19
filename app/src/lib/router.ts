import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

function snapshot(): string {
  // Tolère un « # » en double (ex. href="#" + link()), qui laissait l'adresse changer sans changer de page.
  return window.location.hash.replace(/^#+/, '') || '/'
}

export interface Route {
  path: string
  params: URLSearchParams
}

export function useRoute(): Route {
  const raw = useSyncExternalStore(subscribe, snapshot, () => '/')
  const [path, qs = ''] = raw.split('?')
  return { path, params: new URLSearchParams(qs) }
}

export function navigate(to: string): void {
  window.location.hash = to
}

export function link(path: string, params?: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v) qs.set(k, v)
  const s = qs.toString()
  return `#${path}${s ? `?${s}` : ''}`
}
