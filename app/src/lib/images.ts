/**
 * Packshot officiel d'un produit VEJA, d'après son SKU (format B2B, grande taille).
 * Le SKU du catalogue se termine par une lettre (grille de tailles : EE4323079A) ; l'image porte le SKU sans cette lettre.
 * Si l'image n'existe pas, l'interface retombe sur une pastille de couleur.
 */
export function vejaThumbnail(sku: string): string {
  const base = sku.trim().toUpperCase().replace(/^([A-Z]{2}\d{7})[A-Z]$/, '$1')
  return `https://media.veja-store.com/image/upload/t_PACKSHOTS_B2B_LARGEV2/VEJA/PACKSHOTS/${base}_1.jpg`
}
