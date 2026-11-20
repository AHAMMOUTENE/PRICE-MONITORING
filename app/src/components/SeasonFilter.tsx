import { useState } from 'react'
import { api } from '../api'
import { refresh, useQuery, useZone } from '../lib/app'
import { Icon } from './Icon'
import { useT } from '../lib/i18n'
import { getSeason, setSeason } from '../lib/season'

/**
 * Filtre par saison des rapports (tableau de bord, rapports des comptes et des produits, export) :
 * une seule saison choisie pour tout l'outil, mémorisée. Les produits dont la saison n'est pas connue sont masqués tant qu'un filtre est actif.
 */
export function SeasonFilter() {
  const { t } = useT()
  const { zone } = useZone()
  const catalog = useQuery(() => api.listCatalog(zone), [zone])
  const [value, setValue] = useState(getSeason)
  const seasons = [...new Set((catalog.data ?? []).map((c) => c.season).filter(Boolean))].sort().reverse()
  if (seasons.length === 0) return null
  const options = value && !seasons.includes(value) ? [value, ...seasons] : seasons

  return (
    <label className="seasonfilter">
      <span className="seasonfilter-label">{t('season.label')}</span>
      <select
        aria-label={t('season.label')}
        value={value}
        onChange={(e) => {
          setSeason(e.target.value)
          setValue(e.target.value)
          refresh()
        }}
      >
        <option value="">{t('season.all')}</option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s === 'C/O' ? t('season.carryOver') : s}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" className="icon seasonfilter-chev" />
    </label>
  )
}
