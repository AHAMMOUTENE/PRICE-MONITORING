const KEY = 'pm.season'

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

let current = read()

/** Saison choisie pour les rapports (« AW26 », « C/O »…) ; vide : toutes les saisons. Commune à tous les écrans. */
export function getSeason(): string {
  return current
}

export function setSeason(season: string): void {
  current = season
  try {
    if (season) localStorage.setItem(KEY, season)
    else localStorage.removeItem(KEY)
  } catch {
    /* le choix n'est simplement pas mémorisé */
  }
}
