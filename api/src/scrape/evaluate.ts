/** Règle d'anomalie portée par le produit (identique à celle de l'application). */
export type EvaluationKind = 'anomaly' | 'ok' | 'not-controlled' | 'rrp-missing' | 'unidentified'
export type Reason = 'non-discounted-model' | 'over-max-discount'

export interface EvaluationInput {
  price: number
  /** Produit retenu (confirmé ou proposé) ; absent = fiche non identifiée. */
  hasProduct: boolean
  /** RRP du produit dans la devise de la page. */
  rrp?: number
  /** Remise autorisée : 0 = non soldé, absente = non contrôlé. */
  rulePct?: number
}
export interface Evaluation {
  evaluation: EvaluationKind
  discountPct: number
  reason?: Reason
}

export function evaluate(i: EvaluationInput): Evaluation {
  if (!i.hasProduct) return { evaluation: 'unidentified', discountPct: 0 }
  if (!i.rrp || i.rrp <= 0) return { evaluation: 'rrp-missing', discountPct: 0 }
  const discountPct = Math.min(100, Math.max(0, Math.round((1 - i.price / i.rrp) * 1000) / 10))
  if (i.rulePct === undefined || i.rulePct === null) return { evaluation: 'not-controlled', discountPct }
  if (discountPct >= 1) {
    if (i.rulePct === 0) return { evaluation: 'anomaly', discountPct, reason: 'non-discounted-model' }
    if (discountPct > i.rulePct) return { evaluation: 'anomaly', discountPct, reason: 'over-max-discount' }
  }
  return { evaluation: 'ok', discountPct }
}
