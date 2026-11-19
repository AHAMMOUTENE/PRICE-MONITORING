import type { ReactNode } from 'react'

/**
 * Cadre d'un tableau : il défile dans sa hauteur et sa largeur, et l'en-tête (titres + filtres) reste collé en haut.
 * La barre de défilement horizontale est toujours visible en bas du cadre : pas besoin d'une seconde barre en haut.
 */
export function HScroll({ children, tour }: { children: ReactNode; tour?: string }) {
  return (
    <div className="hscroll" data-tour={tour}>
      <div className="table-wrap">{children}</div>
    </div>
  )
}
