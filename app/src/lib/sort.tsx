import { useState } from 'react'
import { Icon } from '../components/Icon'

export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: string
  dir: SortDir
}
export type Getter<T> = (item: T) => string | number | null | undefined

/** État de tri d'une liste : un clic sur une colonne la trie, un second inverse l'ordre. */
export function useSort(initial?: SortState) {
  const [sort, setSort] = useState<SortState | null>(initial ?? null)
  const toggle = (key: string, first: SortDir) => setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: first }))
  return { sort, toggle }
}

/** Trie une copie de la liste selon la colonne active. Les valeurs vides vont à la fin. Sans tri, l'ordre d'origine est gardé. */
export function sortBy<T>(items: T[], sort: SortState | null, getters: Record<string, Getter<T>>): T[] {
  if (!sort || !getters[sort.key]) return items
  const get = getters[sort.key]
  const m = sort.dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const va = get(a)
    const vb = get(b)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * m
  })
}

interface HeadProps {
  col: string
  label: string
  sort: SortState | null
  onSort: (key: string, first: SortDir) => void
  /** Une colonne de nombres se trie d'abord du plus grand au plus petit. */
  numeric?: boolean
  className?: string
}

function SortButton({ col, label, sort, onSort, numeric }: HeadProps) {
  const active = sort?.key === col
  return (
    <button type="button" className={`sortbtn${active ? ' is-active' : ''}`} onClick={() => onSort(col, numeric ? 'desc' : 'asc')}>
      {label}
      <Icon name={active ? (sort!.dir === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort'} className="icon sort-icon" />
    </button>
  )
}

/** En-tête de colonne triable dans un tableau. */
export function SortTh(props: HeadProps) {
  const active = props.sort?.key === props.col
  return (
    <th scope="col" className={props.className} aria-sort={active ? (props.sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <SortButton {...props} />
    </th>
  )
}

/** En-tête de colonne triable dans une liste faite de lignes `div`. */
export function SortHead(props: HeadProps) {
  return (
    <span className={props.className}>
      <SortButton {...props} />
    </span>
  )
}
