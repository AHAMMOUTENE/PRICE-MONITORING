import { makeRequest } from '../api/http'
import { API_URL } from './config'

/** Mode serveur : les préférences de l'utilisateur (langue, tutoriel vu) sont aussi gardées en base. Sans effet en démonstration. */
export function savePreferences(patch: { locale?: string; tourDone?: boolean }): void {
  if (!API_URL) return
  makeRequest(API_URL)('PUT', '/me/preferences', patch).catch(() => undefined) // le navigateur garde la valeur ; elle sera renvoyée au prochain enregistrement
}
