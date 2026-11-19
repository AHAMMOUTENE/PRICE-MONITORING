import { useState } from 'react'
import { api } from '../../api'
import { distinct } from '../../components/FilterSelect'
import { Icon } from '../../components/Icon'
import { ImportDrawer } from '../../components/ImportDrawer'
import { useToast } from '../../components/toast'
import { AccountLogo, Card, Drawer, Empty, ErrorBlock, LoadingBlock, PageHeader, Pill } from '../../components/ui'
import { refresh, useQuery, useZone } from '../../lib/app'
import { formatShortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { navigate, useRoute } from '../../lib/router'
import { sortBy, SortTh, useSort } from '../../lib/sort'
import { zoneInfo } from '../../lib/zones'
import type { Retailer, SiteVersion } from '../../types'
import { CurrencySelect } from '../../components/CurrencySelect'

const isUrl = (v: string) => /^https?:\/\/\S+\.\S+/.test(v.trim())

function emptyRetailer(zone: Retailer['zone']): Retailer {
  return { id: '', name: '', zone, tracked: true, segmentation: '', salesReps: [], sites: [] }
}

export function AccountsSettings() {
  const { t } = useT()
  const { zone } = useZone()
  const { params } = useRoute()
  const toast = useToast()
  const list = useQuery(() => api.listRetailers(zone), [zone])
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Retailer | null>(null)
  const [importing, setImporting] = useState(false)
  const [seg, setSeg] = useState('')
  const [rep, setRep] = useState('')
  const [site, setSite] = useState('') // '' tous · 'missing' sans page · code devise
  const { sort, toggle } = useSort()

  const editParam = params.get('edit')
  const fromParam = editParam ? ((list.data ?? []).find((r) => r.id === editParam) ?? null) : null
  const open = editing ?? fromParam
  const close = () => {
    setEditing(null)
    if (editParam) navigate('/reglages/comptes')
  }

  if (list.error) return <div className="page"><ErrorBlock message={list.error} onRetry={refresh} /></div>
  if (!list.data) return <div className="page"><LoadingBlock /></div>

  const rows = list.data.filter(
    (r) =>
      (!seg || r.segmentation === seg) &&
      (!rep || r.salesReps.includes(rep)) &&
      (!site || (site === 'missing' ? r.sites.length === 0 : r.sites.some((x) => x.currency === site))) &&
      (!q || r.name.toLowerCase().includes(q.trim().toLowerCase())),
  )
  const siteOptions = [...new Set(list.data.flatMap((r) => r.sites.map((x) => x.currency)))].sort()
  const missing = list.data.filter((r) => r.sites.length === 0).length
  const trackedCount = list.data.filter((r) => r.tracked).length
  const allShownTracked = rows.length > 0 && rows.every((r) => r.tracked)
  const setTracked = async (ids: string[], tracked: boolean) => {
    await api.setTracked(ids, tracked)
    refresh()
  }
  const sorted = sortBy(rows, sort, {
    tracked: (r) => (r.tracked ? 0 : 1),
    account: (r) => r.name,
    segmentation: (r) => r.segmentation || null,
    rep: (r) => r.salesReps.join(', ') || null,
    site: (r) => r.sites.length,
  })

  return (
    <div className="page">
      <PageHeader
        title={t('sAccounts.title')}
        subtitle={`${t('sAccounts.trackedCount', { n: trackedCount, total: list.data.length })}${missing > 0 ? ` · ${t('sAccounts.missing', { n: missing })}` : ''}`}
        actions={
          <>
            <button className="btn btn-secondary" data-tour="import-accounts" onClick={() => setImporting(true)}>
              <Icon name="upload" /> {t('sAccounts.import')}
            </button>
            <button className="btn btn-primary" onClick={() => setEditing(emptyRetailer(zone))}>
              <Icon name="plus" /> {t('sAccounts.add')}
            </button>
          </>
        }
      />

      <ScanLine />

      {list.data.length === 0 ? (
        <Empty title={t('sAccounts.empty')} />
      ) : (
        <Card flush>
          <table className="table table-rows">
            <thead>
              <tr className="head-titles">
                <th scope="col" className="col-switch">{t('sAccounts.scan')}</th>
                <SortTh col="account" label={t('col.account')} sort={sort} onSort={toggle} />
                <SortTh col="segmentation" label={t('col.segmentation')} sort={sort} onSort={toggle} />
                <SortTh col="rep" label={t('col.rep')} sort={sort} onSort={toggle} />
                <SortTh col="site" label={t('col.site')} sort={sort} onSort={toggle} numeric />
                <th scope="col" />
              </tr>
              <tr className="filter-row">
                <th scope="col" className="col-switch">
                  <button className="linkbtn linkbtn-inline" onClick={() => setTracked(rows.map((r) => r.id), !allShownTracked)}>
                    {allShownTracked ? t('sAccounts.allOff') : t('sAccounts.allOn')}
                  </button>
                </th>
                <th scope="col">
                  <input className="cell-filter" type="search" placeholder={t('sAccounts.search')} aria-label={t('sAccounts.search')} value={q} onChange={(e) => setQ(e.target.value)} />
                </th>
                <th scope="col">
                  <select className="cell-filter" aria-label={t('col.segmentation')} value={seg} onChange={(e) => setSeg(e.target.value)}>
                    <option value="">{t('filter.allSegmentations')}</option>
                    {distinct(list.data.map((r) => r.segmentation)).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </th>
                <th scope="col">
                  <select className="cell-filter" aria-label={t('col.rep')} value={rep} onChange={(e) => setRep(e.target.value)}>
                    <option value="">{t('filter.allReps')}</option>
                    {distinct(list.data.flatMap((r) => r.salesReps)).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </th>
                <th scope="col">
                  <select className="cell-filter" aria-label={t('col.site')} value={site} onChange={(e) => setSite(e.target.value)}>
                    <option value="">{t('filter.allSites')}</option>
                    <option value="missing">{t('pill.missing')}</option>
                    {siteOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className={`is-clickable${r.tracked ? '' : ' is-muted'}`} onClick={() => setEditing(r)}>
                  <td className="col-switch" onClick={(e) => e.stopPropagation()}>
                    <label className="switch" title={r.tracked ? t('sAccounts.untrack') : t('sAccounts.track')}>
                      <input type="checkbox" role="switch" aria-label={`${t('sAccounts.scan')} ${r.name}`} checked={r.tracked} onChange={(e) => setTracked([r.id], e.target.checked)} />
                      <span className="switch-track" aria-hidden="true" />
                      <span className="switch-text">{r.tracked ? t('sAccounts.on') : t('sAccounts.off')}</span>
                    </label>
                  </td>
                  <td>
                    <button className="row-btn" onClick={() => setEditing(r)}>
                      <span className="cell-account">
                        <AccountLogo name={r.name} size={34} />
                        <b>{r.name}</b>
                      </span>
                    </button>
                  </td>
                  <td>{r.segmentation || <span className="muted">—</span>}</td>
                  <td>{r.salesReps.join(', ') || <span className="muted">—</span>}</td>
                  <td>
                    {r.sites.length > 0 ? (
                      <span className="chips">
                        {r.sites.map((s, i) => (
                          <Pill key={i} tone="neutral">
                            {s.currency}
                          </Pill>
                        ))}
                      </span>
                    ) : (
                      <Pill tone="warn" icon="alert">
                        {t('pill.missing')}
                      </Pill>
                    )}
                  </td>
                  <td className="num">
                    <Icon name="chevronRight" className="icon muted" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {importing && (
        <ImportDrawer
          title={t('import.accountsTitle')}
          hint={t('import.accountsHint')}
          template="accounts"
          onPreview={(f) => api.previewRetailerImport(f, zone)}
          onDone={(n) => toast.show(t('toast.imported', { n }))}
          onClose={() => setImporting(false)}
        />
      )}
      {open && <AccountDrawer initial={open} onClose={close} />}
    </div>
  )
}

/** Dernier et prochain scan, avec un lancement manuel. */
function ScanLine() {
  const { t } = useT()
  const { zone } = useZone()
  const toast = useToast()
  const week = useQuery(() => api.getWeek(zone), [zone])
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null)

  const run = async () => {
    setScan({ done: 0, total: 0 })
    await api.startScan(zone, (done, total) => setScan({ done, total }))
    setScan(null)
    refresh()
    toast.show(t('scan.done'))
  }

  if (!week.data) return null
  return (
    <div className="scanline">
      <Icon name="clock" className="icon muted" />
      <span>
        {t('scan.last')} : <b>{formatShortDate(week.data.weekOf)}</b> · {t('scan.next')} : <b>{formatShortDate(week.data.nextScan)}</b>
      </span>
      <span className="spacer" />
      {scan ? (
        <>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={scan.total} aria-valuenow={scan.done} aria-label={t('scan.running')}>
            <div style={{ width: `${scan.total ? (scan.done / scan.total) * 100 : 0}%` }} />
          </div>
          <span>
            {scan.done} / {scan.total}
          </span>
        </>
      ) : (
        <button className="btn btn-secondary btn-sm" onClick={run}>
          <Icon name="refresh" /> {t('scan.run')}
        </button>
      )}
    </div>
  )
}

export function AccountDrawer({ initial, onClose }: { initial: Retailer; onClose: () => void }) {
  const { t } = useT()
  const toast = useToast()
  const isNew = initial.id === ''
  const [name, setName] = useState(initial.name)
  const [segmentation, setSegmentation] = useState(initial.segmentation)
  const [reps, setReps] = useState(initial.salesReps.join(', '))
  const defaultCurrency = zoneInfo(initial.zone).defaultCurrency
  const [sites, setSites] = useState<SiteVersion[]>(initial.sites.length ? initial.sites : [{ currency: defaultCurrency, url: '' }])
  const [touched, setTouched] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  // Compte exclu des règles (outlet, boutique officielle) : l'exclusion vit dans les règles de la zone.
  const rules = useQuery(() => api.getRules(initial.zone), [initial.zone])
  const [excludedDraft, setExcludedDraft] = useState<boolean | null>(null)
  const excluded = excludedDraft ?? (rules.data?.excludedRetailerIds.includes(initial.id) ?? false)

  const nameError = name.trim() === '' ? t('err.name') : ''
  const siteErrors = sites.map((s) => (s.url.trim() === '' || isUrl(s.url) ? '' : t('err.url')))
  const hasError = Boolean(nameError) || siteErrors.some(Boolean)

  const save = async () => {
    setTouched(true)
    if (hasError || busy) return
    setBusy(true)
    try {
      const saved = await api.saveRetailer({
        ...initial,
        name: name.trim(),
        segmentation: segmentation.trim(),
        salesReps: reps.split(',').map((r) => r.trim()).filter(Boolean),
        sites: sites.filter((s) => s.url.trim() !== '').map((s) => ({ ...s, url: s.url.trim() })),
      })
      if (rules.data && excludedDraft !== null) {
        const others = rules.data.excludedRetailerIds.filter((id) => id !== saved.id)
        await api.saveRules(initial.zone, { ...rules.data, excludedRetailerIds: excluded ? [...others, saved.id] : others })
      }
      refresh()
      toast.show(isNew ? t('toast.accountAdded') : t('toast.saved'))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    await api.removeRetailer(initial.id)
    refresh()
    toast.show(t('toast.deleted', { name: initial.name }))
    onClose()
  }

  const setSite = (i: number, patch: Partial<SiteVersion>) => setSites((l) => l.map((s, k) => (k === i ? { ...s, ...patch } : s)))

  return (
    <Drawer
      title={isNew ? t('drawer.newAccount') : initial.name}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={confirmDelete ? remove : () => setConfirmDelete(true)}>
              <Icon name="trash" /> {confirmDelete ? t('common.confirmDelete') : t('common.delete')}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="r-name">{t('field.name')}</label>
        <input id="r-name" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={touched && Boolean(nameError)} autoFocus={isNew} />
        {touched && nameError && <span className="error-text">{nameError}</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="r-seg">{t('field.segmentation')}</label>
          <input id="r-seg" className="input" value={segmentation} onChange={(e) => setSegmentation(e.target.value)} placeholder="T1, T2A, PERF…" />
        </div>
        <div className="field">
          <label htmlFor="r-reps">{t('field.rep')}</label>
          <input id="r-reps" className="input" value={reps} onChange={(e) => setReps(e.target.value)} placeholder={t('field.repPlaceholder')} />
        </div>
      </div>
      <label className="field check-row" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <input type="checkbox" checked={excluded} onChange={(e) => setExcludedDraft(e.target.checked)} />
        <span className="delim-label">
          <b>{t('field.excluded')}</b>
          <span>{t('field.excludedHint')}</span>
        </span>
      </label>
      <div className="field">
        <span className="label">{t('field.pages')}</span>
        <div className="stack-sm">
          {sites.map((s, i) => (
            <div key={i}>
              <div className="site-row">
                <CurrencySelect ariaLabel={t('field.currency')} value={s.currency} onChange={(currency) => setSite(i, { currency })} />
                <input className="input" aria-label={t('field.url')} placeholder={t('field.urlPlaceholder')} value={s.url} onChange={(e) => setSite(i, { url: e.target.value })} aria-invalid={Boolean(siteErrors[i])} />
                <button className="iconbtn" aria-label={t('field.remove')} onClick={() => setSites((l) => l.filter((_, k) => k !== i))} disabled={sites.length === 1 && s.url === ''}>
                  <Icon name="x" />
                </button>
              </div>
              {siteErrors[i] && <span className="error-text">{siteErrors[i]}</span>}
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSites((l) => [...l, { currency: l[l.length - 1]?.currency ?? defaultCurrency, url: '' }])}>
            <Icon name="plus" /> {t('field.addSite')}
          </button>
        </div>
      </div>
    </Drawer>
  )
}
