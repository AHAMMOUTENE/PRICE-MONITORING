/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Adresse de l'API (par exemple « /api »). Absente : démonstration locale avec des données fictives. */
  readonly VITE_API_URL?: string
  /** Adresse de déconnexion du SSO ; par défaut celle de Cloudflare Access sur le même domaine. */
  readonly VITE_LOGOUT_URL?: string
  /** Adresse où renvoyer l'utilisateur pour qu'il se connecte ; par défaut, la page actuelle (le SSO intercepte l'accès). */
  readonly VITE_LOGIN_URL?: string
}
