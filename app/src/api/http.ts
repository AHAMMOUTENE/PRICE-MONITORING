/**
 * Client HTTP : mêmes méthodes que `Api`, mais les écritures partent vers le serveur (qui les enregistre dans Supabase),
 * puis l'état de la zone est relu. Les lectures et les calculs d'écran restent ceux de l'application, sur l'état relu.
 */
import type { Api } from './index'
import type { AccountComment, CatalogItem, ImportResult, ReviewDecision, SalePeriod, SessionUser, Zone } from '../types'

export interface RemoteHelpers {
  /** Relit l'état d'une zone et met l'application à jour. */
  reload(zone: Zone): Promise<void>
  zoneOfRetailer(id: string): Zone | undefined
  zoneOfObservation(id: string): Zone | undefined
  zoneOfComment(id: string): Zone | undefined
  zoneOfPeriod(id: string): Zone | undefined
  takePendingImport(token: string): { kind: 'accounts' | 'catalog'; zone: Zone; rows: unknown[] } | undefined
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

export function makeRequest(base: string) {
  return async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      // Les valeurs absentes (règle retirée, prix supprimé) partent en null : « effacer ».
      body: body === undefined ? undefined : JSON.stringify(body, (_k, v) => (v === undefined ? null : v)),
    })
    if (res.status === 401) window.dispatchEvent(new Event('pm:unauthenticated')) // session expirée : page de connexion
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(res.status, data.error ?? 'error')
    }
    // Certaines réponses n'ont pas de corps (204, ou 201 sans contenu) : rien à lire.
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }
}

export function createHttpApi(base: string, mock: Api, h: RemoteHelpers): Api {
  const request = makeRequest(base)
  const z = (zone: Zone | undefined): Zone => {
    if (!zone) throw new Error('zone-unknown')
    return zone
  }
  /** Écrit sur le serveur, puis relit la zone concernée. */
  async function write<T>(zone: Zone, fn: () => Promise<T>): Promise<T> {
    const out = await fn()
    await h.reload(zone)
    return out
  }
  return {
    ...mock,
    getCurrentUser: () => request<SessionUser>('GET', '/me'),

    saveRetailer: (r) => write(r.zone, () => request('PUT', `/zones/${r.zone}/retailers`, r)),
    removeRetailer: (id) => {
      const zone = z(h.zoneOfRetailer(id))
      return write(zone, () => request('DELETE', `/zones/${zone}/retailers/${id}`))
    },
    setTracked: (ids, tracked) => {
      const zone = z(h.zoneOfRetailer(ids[0]))
      return write(zone, () => request('POST', `/zones/${zone}/retailers/tracked`, { ids, tracked }))
    },
    saveRules: (zone, rules) => write(zone, () => request('PUT', `/zones/${zone}/rules`, rules)),

    addComment: (retailerId, text) => {
      const zone = z(h.zoneOfRetailer(retailerId))
      return write(zone, () => request<AccountComment>('POST', `/zones/${zone}/comments`, { retailerId, text }))
    },
    removeComment: (id) => {
      const zone = z(h.zoneOfComment(id))
      return write(zone, () => request('DELETE', `/zones/${zone}/comments/${id}`))
    },

    addProduct: (zone, item) => write(zone, () => request('POST', `/zones/${zone}/products`, item)),
    updateProduct: (zone, sku, patch: Partial<Omit<CatalogItem, 'sku'>>) => write(zone, () => request('PUT', `/zones/${zone}/products/${sku}`, patch)),

    commitImport: async (token, mode = 'add') => {
      const pending = h.takePendingImport(token)
      if (!pending) throw new Error('import-expired')
      return write(pending.zone, () => request<ImportResult>('POST', `/zones/${pending.zone}/imports/${pending.kind}`, { fileName: 'import', mode, rows: pending.rows }))
    },

    addSalePeriod: (p: Omit<SalePeriod, 'id'>) => write(p.zone, () => request('POST', `/zones/${p.zone}/periods`, p)),
    updateSalePeriod: (id, p) => {
      const zone = z(h.zoneOfPeriod(id))
      return write(zone, () => request('PUT', `/zones/${zone}/periods/${id}`, p))
    },
    removeSalePeriod: (id) => {
      const zone = z(h.zoneOfPeriod(id))
      return write(zone, () => request('DELETE', `/zones/${zone}/periods/${id}`))
    },

    decideReview: (id: string, decision: ReviewDecision) => {
      const zone = z(h.zoneOfObservation(id))
      return write(zone, () => request('POST', `/zones/${zone}/listings/${id}/decision`, decision))
    },
    undoReview: (id) => {
      const zone = z(h.zoneOfObservation(id))
      return write(zone, () => request('DELETE', `/zones/${zone}/listings/${id}/decision`))
    },

    /** Lance un scan réel et suit son avancement ; les relevés arrivent à la fin. */
    listScans: (zone) => request('GET', `/zones/${zone}/scans`),
    getEmailPrefs: (zone) => request('GET', `/zones/${zone}/email`),
    saveEmailPrefs: (zone, prefs) => request('PUT', `/zones/${zone}/email`, prefs),
    getScanSchedule: (zone) => request('GET', `/zones/${zone}/schedule`),
    saveScanSchedule: (zone, schedule) => request('PUT', `/zones/${zone}/schedule`, schedule),
    buildHistoryExport: (zone) => request('GET', `/zones/${zone}/exports/history`),

    previewScan: (zone) => request('GET', `/zones/${zone}/scans/preview`),
    reloadZone: (zone) => h.reload(zone),

    startScan: async (zone, onProgress, options) => {
      const { id, total } = await request<{ id: string; total: number }>('POST', `/zones/${zone}/scans`, options?.force ? { force: true } : {})
      onProgress(0, total)
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500))
        const s = await request<{ status: string; done: number; total: number; error?: string | null }>('GET', `/zones/${zone}/scans/${id}`)
        onProgress(s.done, s.total)
        if (s.status === 'queued' || s.status === 'running') continue
        await h.reload(zone)
        if (s.status === 'failed') throw new Error(s.error ?? 'scan-failed')
        return
      }
    },
  }
}
