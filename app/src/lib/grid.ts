/** Filtre d'une colonne de nombres : « 120 », « >100 », « <=150 », « 100-150 ». */
export function matchNumber(value: number | undefined | null, filter: string): boolean {
  const f = filter.replace(/\s/g, '').replace(',', '.')
  if (!f) return true
  if (value === undefined || value === null) return false
  const range = f.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/)
  if (range) return value >= Number(range[1]) && value <= Number(range[2])
  const cmp = f.match(/^(>=|<=|>|<|=)?(-?\d+(?:\.\d+)?)$/)
  if (!cmp) return true
  const n = Number(cmp[2])
  switch (cmp[1]) {
    case '>':
      return value > n
    case '>=':
      return value >= n
    case '<':
      return value < n
    case '<=':
      return value <= n
    default:
      return value === n
  }
}

/** Colonnes choisies par l'utilisateur, mémorisées dans le navigateur. */
export function readColumns(storageKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}
export function writeColumns(storageKey: string, keys: string[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(keys))
  } catch {
    /* non mémorisé */
  }
}
