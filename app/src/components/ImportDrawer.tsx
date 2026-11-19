import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { Drawer } from './ui'
import { api } from '../api'
import { refresh } from '../lib/app'
import { useT, type TKey } from '../lib/i18n'
import { downloadTemplate, type TemplateKind } from '../lib/templates'
import { useToast } from './toast'
import type { CsvDelimiter, ImportOptions, ImportPreview } from '../types'

/**
 * Import d'un fichier Excel ou CSV : dépôt, aperçu, puis confirmation.
 * Avant de confirmer, l'utilisateur peut changer l'onglet lu, le séparateur d'un CSV, et la saison (catalogue) :
 * chaque changement relit le fichier et rafraîchit l'aperçu.
 */
export function ImportDrawer({
  title,
  hint,
  template,
  onPreview,
  onDone,
  onClose,
}: {
  title: string
  hint: string
  /** Quel modèle de fichier proposer au téléchargement. */
  template: TemplateKind
  onPreview: (file: File, options?: ImportOptions) => Promise<ImportPreview>
  /** Appelé après l'import, avec le nombre de lignes importées. */
  onDone: (imported: number) => void
  onClose: () => void
}) {
  const { t } = useT()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [options, setOptions] = useState<ImportOptions>({})
  const [seasonDraft, setSeasonDraft] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const take = async (f: File | undefined, next: ImportOptions = {}) => {
    if (!f) return
    setFile(f)
    setOptions(next)
    setSeasonDraft(null)
    setBusy(true)
    try {
      setPreview(await onPreview(f, next))
    } catch {
      toast.show(t('import.failed'))
    } finally {
      setBusy(false)
    }
  }
  const reread = (patch: ImportOptions) => take(file ?? undefined, { ...options, ...patch })
  const reset = () => {
    setPreview(null)
    setOptions({})
    setSeasonDraft(null)
  }

  return (
    <Drawer
      title={title}
      subtitle={hint}
      onClose={onClose}
      footer={
        preview ? (
          <>
            <button className="btn btn-ghost" onClick={reset}>
              {t('import.anotherFile')}
            </button>
            <button
              className="btn btn-primary"
              disabled={!preview.canImport || busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const n = await api.commitImport(preview.token)
                  refresh()
                  onDone(n)
                  onClose()
                } catch {
                  toast.show(t('import.failed'))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" /> {t('import.saving')}
                </>
              ) : (
                t('import.confirm', { n: preview.rows })
              )}
            </button>
          </>
        ) : undefined
      }
    >
      {!preview ? (
        <div
          className={`dropzone${over ? ' is-over' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            take(e.dataTransfer.files[0])
          }}
        >
          {busy ? <span className="spinner spinner-lg" aria-hidden="true" /> : <Icon name="upload" />}
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              input.current?.click()
            }}
          >
            {busy ? t('import.reading') : t('import.choose')}
          </button>
          <span className="small muted" role="status">
            {busy ? t('import.wait') : t('import.drop')}
          </span>
          <input ref={input} type="file" accept=".xlsx,.xlsm,.csv,.txt,.tsv" className="sr-only" tabIndex={-1} onChange={(e) => {
            take(e.target.files?.[0])
            e.target.value = '' // permet de rechoisir le même fichier après correction
          }} />
        </div>
      ) : null}
      {!preview && (
        <div className="template-box">
          <Icon name="file" className="icon muted" />
          <span className="template-text">
            <b>{t('import.template')}</b>
            <span>{t('import.templateHint')}</span>
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              await downloadTemplate(template)
              toast.show(t('import.templateDone'))
            }}
          >
            <Icon name="download" /> {t('import.template')}
          </button>
        </div>
      )}
      {preview && (
        <div className="stack-sm">
          <p>
            <b>{t('import.file', { file: preview.fileName, n: preview.rows })}</b>
          </p>

          {preview.sheets && preview.sheets.length > 1 && (
            <div className="delim">
              <span className="delim-label">
                <b>{t('import.sheet')}</b>
                <span>{t('import.sheetHint')}</span>
              </span>
              <select className="select select-inline" aria-label={t('import.sheet')} value={preview.sheet ?? preview.sheets[0]} disabled={busy} onChange={(e) => reread({ sheet: e.target.value })}>
                {preview.sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {preview.delimiter && (
            <div className="delim">
              <span className="delim-label">
                <b>{t('import.delimiter')}</b>
                <span>{t('import.delimiterHint')}</span>
              </span>
              <div className="seg" role="group" aria-label={t('import.delimiter')}>
                {(
                  [
                    [';', 'import.delimSemicolon'],
                    [',', 'import.delimComma'],
                    ['\t', 'import.delimTab'],
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} aria-pressed={preview.delimiter === v} disabled={busy} onClick={() => reread({ delimiter: v as CsvDelimiter })}>
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {preview.season !== undefined && (
            <div className="delim">
              <span className="delim-label">
                <b>{t('import.season')}</b>
                <span>{t('import.seasonHint')}</span>
              </span>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input"
                  style={{ width: 110 }}
                  aria-label={t('import.season')}
                  placeholder="AW26"
                  value={seasonDraft ?? preview.season}
                  onChange={(e) => setSeasonDraft(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && seasonDraft !== null) reread({ season: seasonDraft.trim() })
                  }}
                />
                {seasonDraft !== null && seasonDraft.trim() !== preview.season && (
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => reread({ season: seasonDraft.trim() })}>
                    {t('common.apply')}
                  </button>
                )}
              </div>
            </div>
          )}

          {preview.noDiscount !== undefined && (
            <label className="delim check-row">
              <input type="checkbox" checked={preview.noDiscount} disabled={busy} onChange={(e) => reread({ noDiscount: e.target.checked })} />
              <span className="delim-label">
                <b>{t('import.noDiscount')}</b>
                <span>{t('import.noDiscountHint')}</span>
              </span>
            </label>
          )}

          {preview.mapping && preview.fileColumns && (
            <details className="mapping" open={Object.values(preview.mapping).some((i) => i < 0)}>
              <summary>
                <b>{t('import.mapping')}</b>
                <span>{t('import.mappingHint')}</span>
              </summary>
              <div className="mapping-grid">
                {Object.entries(preview.mapping).map(([field, idx]) => (
                  <label key={field} className={idx < 0 ? 'is-missing' : ''}>
                    <span>{t(`imp.${field}` as TKey)}</span>
                    <select className="select" value={idx} disabled={busy} onChange={(e) => reread({ mapping: { ...(options.mapping ?? {}), [field]: Number(e.target.value) } })}>
                      <option value={-1}>{t('import.noColumn')}</option>
                      {preview.fileColumns!.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `#${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          )}
          {preview.recognized.length > 0 && (
            <p className="small muted">
              {t('import.columnsFound')} {preview.recognized.map((r) => `${r.label ?? t(`imp.${r.key}` as TKey)} ← « ${r.from} »`).join(' · ')}
            </p>
          )}
          {preview.sample.length > 0 && (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {preview.header.map((h) => (
                        <th key={h} scope="col">
                          {t(h as TKey)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell || <span className="muted">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.sample.length > 5 && (
                <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll(true)}>
                  <Icon name="search" /> {t('import.seeAll', { n: preview.sample.length })}
                </button>
              )}
            </>
          )}
          {preview.skipped ? <p className="small muted">{t('import.skipped', { n: preview.skipped })}</p> : null}
          {preview.warnings.map((w) => (
            <div className={`banner${preview.canImport ? '' : ' banner-error'}`} key={w.kind + (w.currency ?? '')}>
              <Icon name="alert" />
              <span>
                {w.kind === 'noSite' && t('warn.noSite', { n: w.n })}
                {w.kind === 'noPrice' && t('warn.noPrice', { n: w.n, currency: w.currency ?? '' })}
                {w.kind === 'badPrice' && t('warn.badPrice', { n: w.n })}
                {w.kind === 'missingColumn' && t('import.missingColumn', { column: w.column ?? '' })}
                {w.kind === 'empty' && t('import.empty')}
                {w.kind === 'unsupported' && t('import.unsupported')}
                {w.kind === 'xlsOld' && t('import.xlsOld')}
              </span>
            </div>
          ))}
        </div>
      )}
      {preview && showAll && <AllRows preview={preview} onClose={() => setShowAll(false)} />}
    </Drawer>
  )
}

/** Toutes les lignes lues, dans une fenêtre au-dessus de l'import, pour vérifier avant de confirmer. */
function AllRows({ preview, onClose }: { preview: ImportPreview; onClose: () => void }) {
  const { t } = useT()
  useEffect(() => {
    // En phase de capture : Échap ferme cette fenêtre seulement, pas aussi le tiroir d'import dessous.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label={t('import.allRows')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{t('import.allRows')}</h2>
            <p className="small muted">{t('import.file', { file: preview.fileName, n: preview.sample.length })}</p>
          </div>
          <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body table-wrap">
          <table className="table table-rows">
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                {preview.header.map((h) => (
                  <th key={h} scope="col">
                    {t(h as TKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((row, i) => (
                <tr key={i}>
                  <td className="num muted">{i + 1}</td>
                  {row.map((cell, j) => (
                    <td key={j}>{cell || <span className="muted">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  )
}
