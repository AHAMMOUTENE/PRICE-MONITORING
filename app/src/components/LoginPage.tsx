import { useState } from 'react'
import { API_URL } from '../lib/config'
import { useT } from '../lib/i18n'
import { makeRequest } from '../api/http'

/**
 * Page de connexion. En production il n'y a pas de mot de passe : le SSO de l'entreprise (Cloudflare Access)
 * ouvre la session, et le bouton relance simplement l'accès. En développement, un SSO simulé demande l'adresse
 * e-mail et ouvre une session locale (aucune vérification : jamais actif en production).
 * `server` : le serveur ne répond pas (ce n'est pas un problème de connexion).
 */
export function LoginPage({ kind }: { kind: 'auth' | 'server' }) {
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const simulated = import.meta.env.DEV && kind === 'auth'

  const retry = () => window.location.assign(import.meta.env.VITE_LOGIN_URL || window.location.pathname)
  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(false)
    try {
      await makeRequest(API_URL || '/api')('POST', '/auth/login', { email })
      window.location.reload()
    } catch {
      setError(true)
      setBusy(false)
    }
  }

  return (
    <main className="lang-gate">
      <form className="lang-gate-card login-card" onSubmit={simulated ? signIn : (e) => (e.preventDefault(), retry())}>
        <div>
          <h1>{kind === 'auth' ? t('login.title') : t('login.serverTitle')}</h1>
          <p>{kind === 'auth' ? t('login.text') : t('login.serverText')}</p>
        </div>
        {simulated && (
          <label className="field">
            <span className="label">{t('login.email')}</span>
            <input className="input" type="email" required autoFocus autoComplete="email" placeholder="firstname.lastname@veja.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <span className="error-text" role="alert">{t('login.emailError')}</span>}
          </label>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || (simulated && !email.trim())} autoFocus={!simulated}>
          {kind === 'auth' ? t('login.button') : t('login.retry')}
        </button>
        {simulated && <p className="small muted">{t('login.simulated')}</p>}
      </form>
    </main>
  )
}
