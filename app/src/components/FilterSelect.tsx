import { useT, type TKey } from '../lib/i18n'

/** Menu déroulant de filtre : la première option désactive le filtre. */
export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: TKey
  allLabel: TKey
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const { t } = useT()
  return (
    <select className={`select select-inline${value ? ' is-active' : ''}`} aria-label={t(label)} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t(allLabel)}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Valeurs distinctes, triées, prêtes pour un FilterSelect. */
export function distinct(values: (string | undefined | null)[]): { value: string; label: string }[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((v) => ({ value: v, label: v }))
}
