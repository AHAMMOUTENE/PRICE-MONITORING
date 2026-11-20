/**
 * Adresse de l'API, sur le même domaine que le site : « /api ». Aucun fichier de configuration n'est nécessaire pour construire le site.
 * `npm run dev:demo` (mode « demo ») lance l'interface avec des données fictives, sans serveur : l'adresse est alors vide.
 * `VITE_API_URL`, si elle est fournie à la construction, remplace la valeur par défaut.
 */
export const API_URL: string = import.meta.env.MODE === 'demo' ? '' : (import.meta.env.VITE_API_URL ?? '/api')
