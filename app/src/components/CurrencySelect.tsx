import { CURRENCIES, currencyName } from '../lib/currencies'
import { useT } from '../lib/i18n'
import type { Currency } from '../types'

/** Choix d'une devise : code et nom dans la langue de l'interface. Une devise hors liste reste sélectionnable. */
export function CurrencySelect({ value, onChange, options, id, className = 'select', ariaLabel }: { value: Currency; onChange: (c: Currency) => void; options?: Currency[]; id?: string; className?: string; ariaLabel?: string }) {
  const { t, locale } = useT()
  void locale // le nom des devises suit la langue : re-rendu quand elle change
  const list = options ?? CURRENCIES
  const all = list.includes(value) ? list : [value, ...list]
  return (
    <select id={id} className={className} aria-label={ariaLabel ?? t('col.currency')} value={value} onChange={(e) => onChange(e.target.value)}>
      {all.map((c) => (
        <option key={c} value={c}>
          {c} · {currencyName(c)}
        </option>
      ))}
    </select>
  )
}
