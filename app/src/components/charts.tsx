import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/** Largeur d'un conteneur, suivie quand la fenêtre change. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** Courbe lisse qui ne dépasse jamais ses points (interpolation monotone). */
export function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x)
    m.push((pts[i + 1].y - pts[i].y) / dx[i])
  }
  const t: number[] = new Array(n)
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0
    else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i])
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]
    d += ` C${pts[i].x + h / 3},${pts[i].y + (t[i] * h) / 3} ${pts[i + 1].x - h / 3},${pts[i + 1].y - (t[i + 1] * h) / 3} ${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}

/** Pas « rond » pour les graduations : 1, 2, 5 × 10^k. */
function niceStep(range: number, ticks: number): number {
  const raw = range / ticks
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
}

/* ---------------------------------------------------------------------- */

export interface LineSeries {
  id: string
  label: string
  color: string
  values: number[]
  dashed?: boolean
  dots?: boolean
}

/**
 * Courbes de prix : une série par compte, courbes lisses avec points, repère vertical et infobulle au survol.
 * Utilisable au clavier (flèches gauche et droite).
 */
export function LineChart({
  labels,
  series,
  formatY,
  height = 300,
  ariaLabel,
  highlightId = null,
}: {
  labels: string[]
  series: LineSeries[]
  formatY: (n: number) => string
  height?: number
  ariaLabel: string
  /** Courbe mise en avant (les autres s'estompent), par exemple celle de la légende survolée. */
  highlightId?: string | null
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 64
  const padR = 20
  const padT = 14
  const padB = 30
  const w = Math.max(width, 280)
  const all = series.flatMap((s) => s.values)
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const step = niceStep(Math.max(hi - lo, hi * 0.05, 1), 4)
  const yMin = Math.floor((lo - step * 0.2) / step) * step
  const yMax = Math.ceil((hi + step * 0.2) / step) * step
  const ticks: number[] = []
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v)
  const n = labels.length
  const x = (i: number) => padL + (n === 1 ? (w - padL - padR) / 2 : (i * (w - padL - padR)) / (n - 1))
  const y = (v: number) => padT + ((yMax - v) * (height - padT - padB)) / (yMax - yMin || 1)

  // La courbe mise en avant est dessinée en dernier, donc au-dessus des autres.
  const order = series.map((_, k) => k).sort((a, b) => Number(series[a].id === highlightId) - Number(series[b].id === highlightId))

  const onMove = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left
    const idx = Math.round(((px - padL) / (w - padL - padR)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, idx)))
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1))
    if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1))
    if (e.key === 'Escape') setHover(null)
  }

  const tipLeft = hover === null ? 0 : x(hover)
  const flip = tipLeft > w * 0.6

  return (
    <>
      <div className="chart" ref={ref} style={{ height }}>
        <svg width={w} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} className="chart-grid" />
              <text x={padL - 10} y={y(v) + 4} textAnchor="end" className="chart-axis">
                {formatY(v)}
              </text>
            </g>
          ))}
          {labels.map((l, i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="chart-axis">
              {l}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} className="chart-guide" />}
          {order.map((k) => {
            const s = series[k]
            const active = highlightId === s.id
            const dim = highlightId !== null && !active && !s.dashed
            const pts = s.values.map((v, i) => ({ x: x(i), y: y(v) }))
            return (
              <g key={s.id} opacity={dim ? 0.18 : 1}>
                <path
                  d={smoothPath(pts)}
                  fill="none"
                  stroke={s.dashed ? '#4b5258' : s.color}
                  strokeWidth={s.dashed ? 1.75 : active ? 4 : 2.5}
                  strokeDasharray={s.dashed ? '6 5' : undefined}
                  strokeLinecap="round"
                />
                {s.dots !== false && !s.dashed && pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={active ? 5.5 : 4} fill={s.color} stroke="#fff" strokeWidth={1.75} />)}
                {hover !== null && !s.dashed && <circle cx={pts[hover].x} cy={pts[hover].y} r={9} fill={s.color} opacity={0.18} />}
              </g>
            )
          })}
          <rect
            x={padL}
            y={0}
            width={w - padL - padR}
            height={height - padB}
            fill="transparent"
            onPointerMove={(e) => onMove(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && (
          <div className="chart-tip" style={{ left: tipLeft + (flip ? -12 : 12), transform: flip ? 'translateX(-100%)' : undefined, top: padT }}>
            <b>{labels[hover]}</b>
            {[...series]
              .sort((a, b) => b.values[hover] - a.values[hover])
              .map((s) => (
                <span key={s.id}>
                  <i style={{ background: s.dashed ? '#4b5258' : s.color }} />
                  {s.label}
                  <em>{formatY(s.values[hover])}</em>
                </span>
              ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ---------------------------------------------------------------------- */

/** Histogramme cliquable : une barre par semaine, la semaine choisie en foncé. */
export function BarChart({
  data,
  selected,
  onSelect,
  height = 220,
  ariaLabel,
}: {
  data: { key: string; label: string; value: number }[]
  selected?: string
  onSelect?: (key: string) => void
  height?: number
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const w = Math.max(width, 240)
  const padL = 32
  const padR = 8
  const padT = 22
  const padB = 28
  const raw = Math.max(1, ...data.map((d) => d.value))
  const step = niceStep(raw, 3)
  const max = Math.ceil(raw / step) * step
  const ticks = [0, step, step * 2, step * 3].filter((v) => v <= max + step / 2)
  const slot = (w - padL - padR) / data.length
  const bw = Math.min(44, slot * 0.58)
  const y = (v: number) => padT + ((max - v) * (height - padT - padB)) / max

  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={w} height={height} role="group" aria-label={ariaLabel}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" className="chart-axis">
              {v}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2
          const sel = d.key === selected
          const top = y(d.value)
          return (
            <g
              key={d.key}
              className={`bar${sel ? ' is-selected' : ''}`}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-pressed={onSelect ? sel : undefined}
              aria-label={`${d.label} : ${d.value}`}
              onClick={() => onSelect?.(d.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect?.(d.key)
                }
              }}
            >
              <rect x={padL + slot * i} y={0} width={slot} height={height - padB} fill="transparent" />
              <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(2, height - padB - top)} rx={7} className="bar-fill" />
              <text x={cx} y={top - 6} textAnchor="middle" className="bar-val">
                {d.value}
              </text>
              <text x={cx} y={height - 8} textAnchor="middle" className="chart-axis">
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ---------------------------------------------------------------------- */

/** Huit petites barres pour une cellule de tableau : la dernière semaine en couleur. */
export function MiniBars({ values, label }: { values: number[]; label: string }) {
  const w = 72
  const h = 26
  const max = Math.max(1, ...values)
  const bw = (w - (values.length - 1) * 3) / values.length
  return (
    <svg width={w} height={h} role="img" aria-label={label} className="minibars">
      {values.map((v, i) => {
        const bh = v === 0 ? 2 : Math.max(4, (v / max) * (h - 2))
        const last = i === values.length - 1
        return <rect key={i} x={i * (bw + 3)} y={h - bh} width={bw} height={bh} rx={2} className={last && v > 0 ? 'mb-last' : v === 0 ? 'mb-zero' : 'mb'} />
      })}
    </svg>
  )
}

/** Courbe de prix miniature pour une cellule de tableau. */
export function MiniLine({ values, label, color = 'var(--ink-2)' }: { values: number[]; label: string; color?: string }) {
  const w = 84
  const h = 28
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const range = hi - lo || 1
  const pts = values.map((v, i) => ({ x: 3 + (i * (w - 6)) / (values.length - 1), y: 4 + ((hi - v) * (h - 8)) / range }))
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} role="img" aria-label={label}>
      <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  )
}
