import { useEffect, useState } from 'react'
import { api } from '../api'
import { Icon } from './Icon'
import { ProductImage } from './ui'
import { formatDiscount, formatMoney } from '../lib/format'
import { useZone } from '../lib/app'
import { useT } from '../lib/i18n'
import type { AccountProduct, CatalogItem, ReviewDecision } from '../types'

/**
 * La question posée à l'utilisateur : « Est-ce le même produit ? »
 * À gauche, le produit tel que le revendeur le vend ; à droite, le produit VEJA que l'outil suggère.
 * Deux réponses claires, plus un moyen de désigner le bon produit si la suggestion est fausse :
 * le produit choisi dans la liste REMPLACE la suggestion dans la carte, et l'utilisateur valide ensuite (rien n'est enregistré au clic dans la liste).
 */
export function MatchCard({
  a,
  retailerName,
  onDecide,
  onSkip,
  large = false,
  showHelp = true,
  shortcuts = false,
}: {
  a: AccountProduct
  retailerName: string
  onDecide: (d: ReviewDecision, message: string) => void
  onSkip?: () => void
  large?: boolean
  showHelp?: boolean
  shortcuts?: boolean
}) {
  const { t } = useT()
  const { zone } = useZone()
  const p = a.proposal
  const [picking, setPicking] = useState(!p)
  const [chosen, setChosen] = useState<CatalogItem | null>(null) // produit désigné par l'utilisateur, en remplacement de la suggestion
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CatalogItem[]>([])
  const size = large ? 168 : 96

  useEffect(() => {
    setChosen(null)
    setPicking(!a.proposal)
    setQ('')
  }, [a.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    api.searchCatalog(zone, q).then((r) => alive && setResults(r))
    return () => {
      alive = false
    }
  }, [zone, q])

  /** Valide le produit affiché à droite : celui que l'utilisateur a choisi, sinon la suggestion. */
  const validate = () => (chosen ? onDecide({ kind: 'corrected', sku: chosen.sku }, t('review.corrected')) : onDecide({ kind: 'accepted' }, t('review.confirmed')))
  const shown = chosen ?? p?.item

  useEffect(() => {
    if (!shortcuts) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (picking) return
      if (e.key === 'y' || e.key === 'Y') validate()
      if (e.key === 'n' || e.key === 'N') setPicking(true)
      if (e.key === 'ArrowRight') onSkip?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  return (
    <div className={`match${large ? ' is-large' : ''}`}>
      <div className="match-head">
        <h3>{t('match.question')}</h3>
        {showHelp && <p>{t('match.help')}</p>}
      </div>

      <div className="match-pair">
        <figure className="match-side">
          <ProductImage src={a.image} color={a.color} label={a.title} size={size} />
          <figcaption>
            <span className="k">{t('match.atRetailer', { name: retailerName })}</span>
            <b>{a.title}</b>
            <span>{t('label.sitePriceValue', { value: formatMoney(a.salePrice, a.currency) })}</span>
            <span>{t('label.discount', { value: formatDiscount(a.discountPct) })}</span>
            <a className="textlink" href={a.url} target="_blank" rel="noreferrer">
              {t('match.viewPage')} <Icon name="external" />
            </a>
          </figcaption>
        </figure>

        <div className="match-eq" aria-hidden="true">
          =?
        </div>

        <figure className="match-side is-suggested">
          {shown ? <ProductImage src={shown.image} sku={shown.sku} color={shown.color} label={shown.model} size={size} /> : <ProductImage color={a.color} label="?" size={size} />}
          <figcaption>
            <span className="k">{chosen ? t('match.chosen') : t('match.suggested')}</span>
            {shown ? (
              <>
                <b>
                  {shown.model} {shown.color}
                </b>
                <span>{t('label.sku', { value: shown.sku })}</span>
                <span>{t('label.material', { value: shown.material })}</span>
                {shown.rrp[a.currency] !== undefined && <span>{t('label.reference', { value: formatMoney(shown.rrp[a.currency]!, a.currency) })}</span>}
              </>
            ) : (
              <span className="muted">{t('review.noProposal')}</span>
            )}
          </figcaption>
        </figure>
      </div>

      {!picking ? (
        <div className="match-actions">
          <button className="btn btn-primary" onClick={validate}>
            <Icon name="check" /> {chosen ? t('match.validate') : t('match.yes')}
          </button>
          <button className="btn btn-secondary" onClick={() => setPicking(true)}>
            {chosen ? t('match.pickOther') : t('match.no')}
          </button>
          {chosen && p && (
            <button className="btn btn-ghost" onClick={() => setChosen(null)}>
              {t('match.backToSuggestion')}
            </button>
          )}
          {onSkip && (
            <button className="btn btn-ghost" onClick={onSkip}>
              {t('match.skip')}
            </button>
          )}
        </div>
      ) : (
        <div className="match-pick">
          <h4>{t('match.pick')}</h4>
          <div className="search">
            <Icon name="search" />
            <input className="input" autoFocus placeholder={t('review.searchPlaceholder')} aria-label={t('match.pick')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {results.length > 0 && (
            <div className="suggest" aria-live="polite">
              {results.map((c) => (
                <button
                  key={c.sku}
                  onClick={() => {
                    // Le produit choisi remplace la suggestion ; il reste à valider.
                    setChosen(c)
                    setPicking(false)
                    setQ('')
                  }}
                >
                  <ProductImage sku={c.sku} color={c.color} label={c.model} size={40} />
                  <span>
                    <b>
                      {c.model} {c.color}
                    </b>{' '}
                    <span className="muted">
                      {t('label.sku', { value: c.sku })} · {t('label.material', { value: c.material })}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {q && results.length === 0 && <p className="small muted">{t('review.noResults')}</p>}
          <div className="match-actions">
            <button className="btn btn-secondary" onClick={() => onDecide({ kind: 'no-match' }, t('review.dismissed'))}>
              {t('match.none')}
            </button>
            {shown && (
              <button className="btn btn-ghost" onClick={() => setPicking(false)}>
                {t('common.back')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
