import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/schibsted-grotesk'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/components.css'
import './styles/pages.css'
import { App } from './App'
import { bootRemote } from './api'
import { LoginPage } from './components/LoginPage'
import { I18nProvider } from './lib/i18n'

const root = createRoot(document.getElementById('root')!)
const showLogin = (kind: 'auth' | 'server') =>
  root.render(
    <I18nProvider>
      <LoginPage kind={kind} />
    </I18nProvider>,
  )

// Session expirée en cours d'utilisation : retour à la page de connexion.
window.addEventListener('pm:unauthenticated', () => showLogin('auth'))

// En mode serveur, on charge les données avant d'afficher ; sinon l'application démarre aussitôt.
bootRemote().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  (e) => showLogin(e instanceof Error && e.message === 'unauthenticated' ? 'auth' : 'server'),
)
