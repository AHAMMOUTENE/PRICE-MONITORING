import { Icon } from './Icon'
import { useT } from '../lib/i18n'

/**
 * Pied de liste : « Voir N de plus » tant que des lignes restent cachées, et un lien vers la page complète.
 * Chaque page garde son propre compteur (`limit`) ; `step` = nombre de lignes ajoutées à chaque clic.
 */
export function SeeMore({ total, limit, step, onMore, allHref }: { total: number; limit: number; step: number; onMore: () => void; allHref?: string }) {
  const { t } = useT()
  const rest = total - limit
  if (rest <= 0) return null
  return (
    <div className="seemore">
      <button className="btn btn-secondary btn-sm" onClick={onMore}>
        <Icon name="chevronDown" /> {t('common.seeMoreCount', { n: Math.min(step, rest) })}
      </button>
      {allHref && (
        <a className="textlink" href={allHref}>
          {t('common.seeAll')} <Icon name="chevronRight" />
        </a>
      )}
    </div>
  )
}
