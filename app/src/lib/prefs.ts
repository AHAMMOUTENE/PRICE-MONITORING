import { makeRequest } from '../api/http'

/** Mode serveur : les préférences de l'utilisateur (langue, tutoriel vu) sont aussi gardées en base. Sans effet en démonstration. */
export function savePreferences(patch: { locale?: string; tourDone?: boolean }): void {
  const base = import.meta.env.VITE_API_URL
  if (!base) return
  makeRequest(base)('PUT', '/me/preferences', patch).catch(() => undefined) // le navigateur garde la valeur ; elle sera renvoyée au prochain enregistrement
}
