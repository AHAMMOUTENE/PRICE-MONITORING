import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { fr, type Key } from '../i18n/fr'
import { en } from '../i18n/en'
import { pt } from '../i18n/pt'
import { es } from '../i18n/es'
import { intlLocale, setActiveLocale, type Locale } from './format'
import { savePreferences } from './prefs'

const DICTS: Record<Locale, Record<Key, string>> = { fr, en, pt, es }

export const LANGUAGES: { id: Locale; label: string }[] = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
  { id: 'pt', label: 'Português' },
  { id: 'es', label: 'Español' },
]

/** Une clé de traduction, ou la base d'une clé à pluriel (« count.product » pour « count.product.one/other »). */
type PluralBase<K> = K extends `${infer B}.${'one' | 'other'}` ? B : never
export type TKey = Key | PluralBase<Key>
export type Params = Record<string, string | number>

export function translate(locale: Locale, key: TKey, params?: Params): string {
  const dict = DICTS[locale]
  let k: string = key
  if (typeof params?.n === 'number') {
    const cat = new Intl.PluralRules(intlLocale(locale)).select(params.n) === 'one' ? 'one' : 'other'
    if (`${key}.${cat}` in dict) k = `${key}.${cat}`
  }
  const raw = (dict as Record<string, string>)[k] ?? (fr as Record<string, string>)[k] ?? k
  return params ? raw.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)) : raw
}

interface I18n {
  locale: Locale
  setLocale: (l: Locale) => void
  /** Faux tant que l'utilisateur n'a pas choisi sa langue (première connexion). */
  chosen: boolean
  t: (key: TKey, params?: Params) => string
}

const I18nContext = createContext<I18n>({ locale: 'en', setLocale: () => undefined, chosen: true, t: (k, p) => translate('en', k, p) })

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem('pm.lang') as Locale | null
    if (saved && saved in DICTS) return saved
  } catch {
    /* stockage indisponible */
  }
  return 'en' // langue de départ ; l'utilisateur choisit la sienne à la première connexion
}

function hasChosen(): boolean {
  try {
    return localStorage.getItem('pm.lang') !== null
  } catch {
    return true // sans stockage on ne peut pas mémoriser le choix : inutile de le demander à chaque visite
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [chosen, setChosen] = useState(hasChosen)
  // Les formats (dates, montants) lisent la langue active : on la fixe avant d'afficher les enfants.
  setActiveLocale(locale)
  if (typeof document !== 'undefined') document.documentElement.lang = locale

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    setChosen(true)
    savePreferences({ locale: l })
    try {
      localStorage.setItem('pm.lang', l)
    } catch {
      /* la langue n'est simplement pas mémorisée */
    }
  }, [])

  const value = useMemo<I18n>(() => ({ locale, setLocale, chosen, t: (key, params) => translate(locale, key, params) }), [locale, setLocale, chosen])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT(): I18n {
  return useContext(I18nContext)
}
