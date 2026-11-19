import type { ReactNode } from 'react'
import { LANGUAGES, useT } from '../lib/i18n'

/** Première connexion : l'utilisateur choisit sa langue avant de voir l'application (puis le tutoriel, dans cette langue). */
export function LanguageGate({ children }: { children: ReactNode }) {
  const { chosen, setLocale } = useT()
  if (chosen) return <>{children}</>
  return (
    <main className="lang-gate">
      <div className="lang-gate-card">
        <div>
          <h1>Choose your language</h1>
          <p>You can change it at any time from the menu.</p>
        </div>
        <div className="lang-gate-list">
          {LANGUAGES.map((l) => (
            <button key={l.id} type="button" lang={l.id} onClick={() => setLocale(l.id)} autoFocus={l.id === 'en'}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
