/**
 * Récapitulatif envoyé par e-mail après chaque scan, aux seules personnes qui l'ont activé (opt-in, par zone).
 * Il commence par les indicateurs du tableau de bord (produits en anomalie, nouvelles anomalies, produits à identifier,
 * retailers concernés), puis liste les actions à mener : retailers à revoir, retailers toujours à corriger depuis le scan
 * précédent, et ce qui reste à faire (produits à identifier, retailers sans site). Chaque lien renvoie vers l'application.
 * Chaque personne choisit les rubriques d'actions qu'elle veut recevoir ; les indicateurs sont toujours présents.
 */
import type { Sql } from './db.ts'
import type { Mailer } from './mail.ts'

export const EMAIL_KINDS = ['review', 'recurrence', 'todo'] as const
export type EmailKind = (typeof EMAIL_KINDS)[number]
type Lang = 'fr' | 'en' | 'pt' | 'es'

export interface Recap {
  zone: string
  scannedAt: string
  pages: number
  failed: number
  seen: number
  kpis: {
    /** Produits confirmés au-dessus de la remise autorisée lors de ce scan, et écart avec le scan précédent (null : pas de scan précédent). */
    anomalies: number
    deltaAnomalies: number | null
    /** Parmi eux, ceux qui ne l'étaient pas au scan précédent (null : pas de scan précédent). */
    fresh: number | null
    toIdentify: number
    retailersInAnomaly: number
    retailersTracked: number
  }
  review: { id: string; name: string; n: number; pct: number }[]
  recurrence: { id: string; name: string; n: number; pct: number }[]
  noSite: number
}

/** Indicateurs et actions après le scan `scanId` de la zone. */
export async function buildRecap(q: Sql, zone: string, scanId: string): Promise<Recap> {
  const [scan] = await q.query<{ at: string; pages: number; failed: number; seen: number }>(
    "select to_char(created_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') as at, sites_total as pages, sites_failed as failed, listings_seen as seen from scans where id = $1",
    [scanId],
  )
  // Fiches confirmées en anomalie lors d'un scan : retailers suivis et non exclus.
  const anomalyJoin = `from observations o
       join observation_evaluations e on e.observation_id = o.id and e.is_current
       join accounts a on a.id = o.account_id
       where o.scan_id = $1 and e.evaluation = 'anomaly' and e.proof = 'confirmed' and not a.excluded and a.status = 'active' and a.tracked`
  const byRetailer = (id: string) =>
    q.query<{ id: string; name: string; n: number; pct: number }>(
      `select a.id, a.name, count(distinct o.listing_id)::int as n, max(e.discount_pct)::float8 as pct ${anomalyJoin}
       group by a.id, a.name order by n desc, pct desc, a.name limit 40`,
      [id],
    )
  const totals = async (id: string) => (await q.query<{ n: number; r: number }>(`select count(distinct o.listing_id)::int as n, count(distinct o.account_id)::int as r ${anomalyJoin}`, [id]))[0]
  const review = await byRetailer(scanId)
  const now = await totals(scanId)

  // Scan précédent de la zone (celui qui a relevé des prix) : sert aux écarts et à « toujours à corriger ».
  const [prev] = await q.query<{ id: string }>(
    `select s.id from scans s where s.zone_id = $1 and s.id <> $2 and s.created_at < (select created_at from scans where id = $2)
       and exists (select 1 from observations x where x.scan_id = s.id) order by s.created_at desc limit 1`,
    [zone, scanId],
  )
  let recurrence: Recap['recurrence'] = []
  let deltaAnomalies: number | null = null
  let fresh: number | null = null
  if (prev) {
    deltaAnomalies = now.n - (await totals(prev.id)).n
    const still = `and exists (select 1 from observations p join observation_evaluations pe on pe.observation_id = p.id and pe.is_current
                       where p.scan_id = $2 and p.listing_id = o.listing_id and pe.evaluation = 'anomaly' and pe.proof = 'confirmed')`
    recurrence = await q.query(
      `select a.id, a.name, count(distinct o.listing_id)::int as n, max(e.discount_pct)::float8 as pct ${anomalyJoin} ${still}
       group by a.id, a.name order by n desc, a.name limit 40`,
      [scanId, prev.id],
    )
    const [same] = await q.query<{ n: number }>(`select count(distinct o.listing_id)::int as n ${anomalyJoin} ${still}`, [scanId, prev.id])
    fresh = now.n - same.n
  }
  const [ti] = await q.query<{ n: number }>(
    "select count(distinct l.id)::int as n from observations o join listings l on l.id = o.listing_id where o.scan_id = $1 and l.proof = 'to-review' and l.status = 'active'",
    [scanId],
  )
  const [tracked] = await q.query<{ n: number }>(
    "select count(*)::int as n from accounts a where a.zone_id = $1 and a.status = 'active' and a.tracked and exists (select 1 from account_sites s where s.account_id = a.id and s.enabled)",
    [zone],
  )
  const [ns] = await q.query<{ n: number }>(
    "select count(*)::int as n from accounts a where a.zone_id = $1 and a.status = 'active' and a.tracked and not exists (select 1 from account_sites s where s.account_id = a.id and s.enabled)",
    [zone],
  )
  return {
    zone,
    scannedAt: scan?.at ?? '',
    pages: scan?.pages ?? 0,
    failed: scan?.failed ?? 0,
    seen: scan?.seen ?? 0,
    kpis: { anomalies: now.n, deltaAnomalies, fresh, toIdentify: ti?.n ?? 0, retailersInAnomaly: now.r, retailersTracked: tracked?.n ?? 0 },
    review,
    recurrence,
    noSite: ns?.n ?? 0,
  }
}

const T: Record<Lang, Record<string, string>> = {
  fr: {
    subject: '{zone} : {a} produit(s) en anomalie, {n} retailer(s) à revoir',
    subjectNone: '{zone} : scan terminé, aucune anomalie',
    title: 'Scan {zone} terminé',
    stats: '{pages} pages visitées, {seen} produits vus{failed}',
    failed: ', {n} en échec',
    kAnomalies: 'Produits en anomalie',
    kNew: 'Nouvelles anomalies',
    kIdentify: 'Produits à identifier',
    kRetailers: 'Retailers concernés',
    kOutOf: 'sur {total} suivis',
    kDelta: '{d} depuis le scan précédent',
    kFirst: 'premier scan',
    actions: 'Actions à mener',
    review: 'Retailers à revoir',
    reviewLine: '{n} produit(s) au-dessus de la remise autorisée, jusqu’à {pct}',
    recurrence: 'Toujours à corriger depuis le scan précédent',
    todo: 'À faire',
    toIdentify: '{n} produit(s) à identifier',
    noSite: '{n} retailer(s) sans site',
    nothing: 'Rien à faire : tout est conforme.',
    open: 'Ouvrir l’application',
    footer: 'Vous recevez cet e-mail parce que vous l’avez activé dans Notifications. Vous pouvez le désactiver à tout moment.',
  },
  en: {
    subject: '{zone}: {a} product(s) in anomaly, {n} retailer(s) to review',
    subjectNone: '{zone}: scan finished, no anomaly',
    title: '{zone} scan finished',
    stats: '{pages} pages visited, {seen} products seen{failed}',
    failed: ', {n} failed',
    kAnomalies: 'Products in anomaly',
    kNew: 'New anomalies',
    kIdentify: 'Products to identify',
    kRetailers: 'Retailers concerned',
    kOutOf: 'out of {total} tracked',
    kDelta: '{d} since the previous scan',
    kFirst: 'first scan',
    actions: 'Actions to take',
    review: 'Retailers to review',
    reviewLine: '{n} product(s) above the allowed discount, up to {pct}',
    recurrence: 'Still to fix since the previous scan',
    todo: 'To do',
    toIdentify: '{n} product(s) to identify',
    noSite: '{n} retailer(s) without a site',
    nothing: 'Nothing to do: everything is compliant.',
    open: 'Open the app',
    footer: 'You receive this email because you turned it on in Notifications. You can turn it off at any time.',
  },
  pt: {
    subject: '{zone}: {a} produto(s) em infração, {n} revendedor(es) a rever',
    subjectNone: '{zone}: varredura concluída, nenhuma infração',
    title: 'Varredura {zone} concluída',
    stats: '{pages} páginas visitadas, {seen} produtos vistos{failed}',
    failed: ', {n} com falha',
    kAnomalies: 'Produtos em infração',
    kNew: 'Novas infrações',
    kIdentify: 'Produtos a identificar',
    kRetailers: 'Revendedores envolvidos',
    kOutOf: 'de {total} monitorados',
    kDelta: '{d} desde a varredura anterior',
    kFirst: 'primeira varredura',
    actions: 'Ações a tomar',
    review: 'Revendedores a rever',
    reviewLine: '{n} produto(s) acima do desconto permitido, até {pct}',
    recurrence: 'Ainda por corrigir desde a varredura anterior',
    todo: 'A fazer',
    toIdentify: '{n} produto(s) a identificar',
    noSite: '{n} revendedor(es) sem site',
    nothing: 'Nada a fazer: tudo conforme.',
    open: 'Abrir o aplicativo',
    footer: 'Você recebe este e-mail porque o ativou em Notificações. Pode desativá-lo a qualquer momento.',
  },
  es: {
    subject: '{zone}: {a} producto(s) en anomalía, {n} minorista(s) por revisar',
    subjectNone: '{zone}: escaneo terminado, ninguna anomalía',
    title: 'Escaneo {zone} terminado',
    stats: '{pages} páginas visitadas, {seen} productos vistos{failed}',
    failed: ', {n} con error',
    kAnomalies: 'Productos en anomalía',
    kNew: 'Nuevas anomalías',
    kIdentify: 'Productos por identificar',
    kRetailers: 'Minoristas afectados',
    kOutOf: 'de {total} seguidos',
    kDelta: '{d} desde el escaneo anterior',
    kFirst: 'primer escaneo',
    actions: 'Acciones a realizar',
    review: 'Minoristas por revisar',
    reviewLine: '{n} producto(s) por encima del descuento permitido, hasta {pct}',
    recurrence: 'Aún por corregir desde el escaneo anterior',
    todo: 'Por hacer',
    toIdentify: '{n} producto(s) por identificar',
    noSite: '{n} minorista(s) sin sitio',
    nothing: 'Nada que hacer: todo conforme.',
    open: 'Abrir la aplicación',
    footer: 'Recibes este correo porque lo activaste en Notificaciones. Puedes desactivarlo en cualquier momento.',
  },
}
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? ''))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Sujet, version HTML et version texte du récapitulatif : les indicateurs d'abord, puis les actions choisies. */
export function renderRecap(r: Recap, lang: Lang, kinds: EmailKind[], appUrl: string): { subject: string; html: string; text: string } {
  const t = T[lang] ?? T.en
  const base = appUrl.replace(/\/$/, '')
  const pct = (n: number) => `−${Math.round(n)}%`
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')
  const k = r.kpis

  // 1. Les indicateurs du tableau de bord.
  const tiles: { label: string; value: string; hint: string; href: string; tone: string }[] = [
    { label: t.kAnomalies, value: String(k.anomalies), hint: k.deltaAnomalies === null ? t.kFirst : fill(t.kDelta, { d: signed(k.deltaAnomalies) }), href: `${base}/#/produits`, tone: k.anomalies > 0 ? '#b00020' : '#0f5c43' },
    { label: t.kNew, value: k.fresh === null ? '–' : String(k.fresh), hint: k.fresh === null ? t.kFirst : '', href: `${base}/#/produits`, tone: k.fresh ? '#b00020' : '#0f5c43' },
    { label: t.kIdentify, value: String(k.toIdentify), hint: '', href: `${base}/#/identifier`, tone: k.toIdentify > 0 ? '#9a5b00' : '#0f5c43' },
    { label: t.kRetailers, value: String(k.retailersInAnomaly), hint: fill(t.kOutOf, { total: k.retailersTracked }), href: `${base}/#/comptes`, tone: '#12161a' },
  ]

  // 2. Les actions à mener, selon les rubriques choisies.
  const sections: { title: string; lines: { label: string; detail: string; href: string }[] }[] = []
  if (kinds.includes('review') && r.review.length > 0) sections.push({ title: t.review, lines: r.review.map((x) => ({ label: x.name, detail: fill(t.reviewLine, { n: x.n, pct: pct(x.pct) }), href: `${base}/#/comptes/${x.id}` })) })
  if (kinds.includes('recurrence') && r.recurrence.length > 0) sections.push({ title: t.recurrence, lines: r.recurrence.map((x) => ({ label: x.name, detail: fill(t.reviewLine, { n: x.n, pct: pct(x.pct) }), href: `${base}/#/comptes/${x.id}` })) })
  if (kinds.includes('todo') && (k.toIdentify > 0 || r.noSite > 0)) {
    const lines = []
    if (k.toIdentify > 0) lines.push({ label: fill(t.toIdentify, { n: k.toIdentify }), detail: '', href: `${base}/#/identifier` })
    if (r.noSite > 0) lines.push({ label: fill(t.noSite, { n: r.noSite }), detail: '', href: `${base}/#/reglages/comptes` })
    sections.push({ title: t.todo, lines })
  }
  const stats = fill(t.stats, { pages: r.pages, seen: r.seen, failed: r.failed > 0 ? fill(t.failed, { n: r.failed }) : '' })
  const subject = k.anomalies > 0 || r.review.length > 0 ? fill(t.subject, { zone: r.zone, a: k.anomalies, n: r.review.length }) : fill(t.subjectNone, { zone: r.zone })

  const tileHtml = tiles
    .map(
      (x) =>
        `<td style="width:25%;padding:0 4px;vertical-align:top"><a href="${esc(x.href)}" style="display:block;text-decoration:none;color:#12161a;background:#f4f5f6;border-radius:10px;padding:12px 10px"><div style="font-size:26px;font-weight:700;color:${x.tone};line-height:1.1">${esc(x.value)}</div><div style="font-size:12px;font-weight:600;margin-top:4px">${esc(x.label)}</div>${x.hint ? `<div style="font-size:11px;color:#5b656d;margin-top:2px">${esc(x.hint)}</div>` : ''}</a></td>`,
    )
    .join('')
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;color:#12161a">
<h2 style="margin:0 0 4px">${esc(fill(t.title, { zone: r.zone }))}</h2>
<p style="margin:0 0 16px;color:#5b656d">${esc(stats)}</p>
<table role="presentation" style="width:100%;border-collapse:separate;margin:0 -4px 8px"><tr>${tileHtml}</tr></table>
<h3 style="margin:22px 0 6px;font-size:16px">${esc(t.actions)}</h3>
${sections.length === 0 ? `<p>${esc(t.nothing)}</p>` : sections.map((s) => `<h4 style="margin:14px 0 6px;font-size:14px">${esc(s.title)}</h4><ul style="padding-left:18px;margin:0">${s.lines.map((l) => `<li style="margin:4px 0"><a href="${esc(l.href)}" style="color:#0f5c43;font-weight:600;text-decoration:none">${esc(l.label)}</a>${l.detail ? ` <span style="color:#5b656d">${esc(l.detail)}</span>` : ''}</li>`).join('')}</ul>`).join('')}
<p style="margin:24px 0"><a href="${esc(base)}/#/notifications" style="background:#0f5c43;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${esc(t.open)}</a></p>
<p style="color:#8a949b;font-size:12px">${esc(t.footer)}</p></div>`
  const text = [
    fill(t.title, { zone: r.zone }),
    stats,
    '',
    ...tiles.map((x) => `${x.label}: ${x.value}${x.hint ? ` (${x.hint})` : ''}`),
    '',
    t.actions,
    ...(sections.length === 0 ? [t.nothing] : sections.flatMap((s) => ['', s.title, ...s.lines.map((l) => `- ${l.label}${l.detail ? ` ${l.detail}` : ''}: ${l.href}`)])),
    '',
    `${t.open}: ${base}/#/notifications`,
    '',
    t.footer,
  ].join('\n')
  return { subject, html, text }
}

/** Envoie le récapitulatif aux abonnés de la zone. Renvoie le nombre d'e-mails envoyés ; aucune adresse n'est écrite dans les journaux. */
export async function sendScanRecaps(q: Sql, mailer: Mailer | null | undefined, zone: string, scanId: string, appUrl: string, log: (e: string, d?: Record<string, unknown>) => void, defaultRole = 'editor'): Promise<number> {
  const subs = await q.query<{ email: string; locale: string | null; kinds: string[]; is_admin: boolean; role: string | null }>(
    `select z.user_email::text as email, p.locale, coalesce(p.ui->'emailKinds', '["review","recurrence","todo"]'::jsonb) as kinds, u.is_admin, r.role::text as role
     from user_email_zones z
     join user_preferences p on p.user_email = z.user_email and p.email_frequency = 'each-scan'
     join users u on u.email = z.user_email
     left join user_zone_access r on r.user_email = z.user_email and r.zone_id = z.zone_id
     where z.zone_id = $1 limit 100`,
    [zone],
  )
  const allowed = subs.filter((s) => s.is_admin || s.role !== null || defaultRole !== 'none')
  if (allowed.length === 0) return 0
  if (!mailer) {
    log('mail-not-configured', { zone, recipients: allowed.length })
    return 0
  }
  const recap = await buildRecap(q, zone, scanId)
  let sent = 0
  for (const s of allowed) {
    const kinds = (Array.isArray(s.kinds) ? s.kinds : []).filter((k): k is EmailKind => (EMAIL_KINDS as readonly string[]).includes(k))
    const lang = (['fr', 'en', 'pt', 'es'] as const).find((l) => l === s.locale) ?? 'en'
    try {
      await mailer.send({ to: s.email, ...renderRecap(recap, lang, kinds, appUrl) })
      sent++
    } catch (e) {
      log('mail-failed', { zone, error: String(e instanceof Error ? e.message : e) })
    }
  }
  log('mail-sent', { zone, sent })
  return sent
}
