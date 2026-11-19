import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { MatchCard } from '../components/MatchCard'
import { Card, LoadingBlock, PageHeader } from '../components/ui'
import { refresh, useZone } from '../lib/app'
import { useT } from '../lib/i18n'
import { useRoute } from '../lib/router'
import type { AccountProduct, ReviewDecision } from '../types'

type Item = AccountProduct & { retailerName: string }
interface Answer {
  id: string
  kind: ReviewDecision['kind']
}

/** Parcours guidé : un produit à la fois, une question, deux réponses, une barre de progression. */
export function Identify() {
  const { t } = useT()
  const { zone } = useZone()
  const { params } = useRoute()
  const retailerId = params.get('retailer') ?? undefined
  const firstId = params.get('product') ?? undefined
  const [queue, setQueue] = useState<Item[] | null>(null)
  const [pos, setPos] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const busy = useRef(false)

  const load = () => {
    setQueue(null)
    setPos(0)
    setAnswers([])
    return api.listToIdentify(zone, retailerId).then(setQueue)
  }

  useEffect(() => {
    let alive = true
    api.listToIdentify(zone, retailerId).then((q) => {
      if (!alive) return
      // Le produit choisi dans une liste passe en premier.
      setQueue(firstId ? [...q].sort((x, y) => Number(y.id === firstId) - Number(x.id === firstId)) : q)
      setPos(0)
      setAnswers([])
    })
    return () => {
      alive = false
    }
  }, [zone, retailerId, firstId])

  const back = { href: retailerId ? `#/comptes/${encodeURIComponent(retailerId)}` : '#/', label: retailerId ? t('nav.accounts') : t('nav.dashboard') }

  if (!queue) return <div className="page"><LoadingBlock /></div>

  const total = queue.length
  const finished = pos >= total
  const current = queue[pos]
  const yes = answers.filter((a) => a.kind !== 'no-match').length
  const no = answers.filter((a) => a.kind === 'no-match').length
  const skipped = total - answers.length

  // Une seule réponse à la fois : un double clic ou une touche maintenue ne saute pas de produit.
  const decide = async (item: Item, decision: ReviewDecision) => {
    if (busy.current) return
    busy.current = true
    try {
      await api.decideReview(item.id, decision)
      refresh()
      setAnswers((a) => [...a, { id: item.id, kind: decision.kind }])
      setPos((p) => p + 1)
    } finally {
      busy.current = false
    }
  }

  const undo = async () => {
    const last = answers[answers.length - 1]
    if (!last || busy.current) return
    busy.current = true
    try {
      await api.undoReview(last.id)
      refresh()
      setAnswers((a) => a.slice(0, -1))
      setPos(queue.findIndex((q) => q.id === last.id))
    } finally {
      busy.current = false
    }
  }

  return (
    <div className="page page-narrow">
      <PageHeader back={back} title={t('match.title')} />

      {total === 0 || finished ? (
        <Card>
          <div className="identify-done">
            <span className="done-icon">
              <Icon name="checkCircle" />
            </span>
            <h2>{t('match.doneTitle')}</h2>
            {answers.length > 0 && <p>{t('match.summary', { yes, no })}</p>}
            <div className="match-actions">
              <a className="btn btn-primary" href={back.href}>
                {t('match.backDashboard')}
              </a>
              {skipped > 0 && total > 0 && (
                <button className="btn btn-secondary" onClick={load}>
                  {t('match.resume', { n: skipped })}
                </button>
              )}
              {answers.length > 0 && (
                <button className="btn btn-ghost" onClick={undo}>
                  {t('match.undo')}
                </button>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className="identify-progress" role="status">
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={pos} aria-label={t('match.title')}>
              <div style={{ width: `${(pos / total) * 100}%` }} />
            </div>
            <span>{t('match.progress', { done: pos + 1, total })}</span>
          </div>

          <div data-tour="identify-card">
          <Card>
            <MatchCard
              key={current.id}
              a={current}
              retailerName={current.retailerName}
              large
              shortcuts
              onDecide={(d) => decide(current, d)}
              onSkip={() => setPos((p) => p + 1)}
            />
          </Card>
          </div>

          {answers.length > 0 && (
            <button className="btn btn-ghost btn-sm identify-undo" onClick={undo}>
              <Icon name="chevronLeft" /> {t('match.undo')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
