import type { Anomaly, CatalogItem, Observation, Reason, Retailer } from '../types'

/** Remise en % (une décimale) par rapport au prix de référence, pour la semaine d'index `i`. */
export function discountAt(o: Observation, i: number): number {
  const p = o.history[i]?.price ?? o.rrp
  if (!o.rrp) return 0
  return Math.max(0, Math.round((1 - p / o.rrp) * 1000) / 10)
}

/** Règle de remise d'un produit ; absente, le produit n'est pas contrôlé. */
export function discountLimit(item: CatalogItem | undefined): number | undefined {
  return item?.maxDiscountPct
}

/**
 * Règle d'anomalie, portée par le produit :
 *  - un produit non soldé (règle 0 %) qui porte une remise (≥ 1 %) ;
 *  - ou une remise supérieure à la règle du produit.
 * Un produit sans règle n'est pas contrôlé.
 */
export function reasonAt(o: Observation, i: number, item: CatalogItem | undefined): Reason | null {
  const d = discountAt(o, i)
  if (d < 1) return null
  const limit = discountLimit(item)
  if (limit === undefined) return null
  if (limit === 0) return 'non-discounted-model'
  if (d > limit) return 'over-max-discount'
  return null
}

export function toAnomaly(o: Observation, retailer: Retailer, i: number, item: CatalogItem | undefined): Anomaly | null {
  const reason = reasonAt(o, i, item)
  if (!reason) return null
  let consecutive = 0
  for (let k = i; k >= 0 && reasonAt(o, k, item); k--) consecutive++
  return {
    ...o,
    retailerName: retailer.name,
    segmentation: retailer.segmentation,
    salesReps: retailer.salesReps,
    salePrice: o.history[i].price,
    discountPct: discountAt(o, i),
    reason,
    discountLimitPct: discountLimit(item) ?? 0,
    consecutiveChecks: consecutive,
    firstSeen: o.history[i - consecutive + 1].week,
    lastSeen: o.history[i].week,
  }
}

export function reasonText(a: Pick<Anomaly, 'reason' | 'model' | 'discountPct' | 'discountLimitPct'>): string {
  if (a.reason === 'non-discounted-model') {
    return `Le produit ${a.model} n'est pas soldé, et ce revendeur le propose avec une remise.`
  }
  return `La remise de ${Math.round(a.discountPct)} % dépasse la remise autorisée de ${a.discountLimitPct} % pour ce produit.`
}
