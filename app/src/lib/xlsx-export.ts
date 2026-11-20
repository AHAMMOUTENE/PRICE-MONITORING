import type { ExportData, HistoryExport } from '../types'
import { downloadBlob } from './format'

const PINK = 'FFF6D9EC'
const THIN = { style: 'thin' as const }
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN }

/**
 * Génère le classeur Excel et le télécharge.
 *  - Onglet « Wholesale <saison> » : le fichier « FOLLOW UP IMAGE ONLINE », une ligne par revendeur.
 *  - Onglet « Détail » : une ligne par produit en anomalie, pour justifier chaque ligne de la synthèse.
 * La bibliothèque est chargée à la demande pour ne pas alourdir l'application.
 */
export async function downloadWorkbook(data: ExportData): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'VEJA – Suivi des prix'

  // --- Synthèse ---------------------------------------------------------
  const ws = wb.addWorksheet(`Wholesale ${data.season}`)
  ws.mergeCells('A1:I1')
  const title = ws.getCell('A1')
  title.value = `VEJA IMAGE ONLINE — ${data.season}`
  title.font = { bold: true, size: 14 }

  // Les colonnes du fichier de suivi de l'équipe ; « UPDATE SALES TEAM » reste à remplir à la main.
  const headers = [
    'STORE NAME', 'STORE WEBSITE', 'SEGMENTATION', 'SALES REP',
    'C/O ON SALE OR RRP NOT ALIGNED', 'NUMBER OF SKUs', 'PERCENTAGE OF DISCOUNTS', 'COMMENTS', 'UPDATE SALES TEAM',
  ]
  const headerRow = ws.getRow(3)
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } }
    cell.alignment = { wrapText: true, vertical: 'middle' }
    cell.border = BORDER
  })
  headerRow.height = 32

  data.summary.forEach((r, i) => {
    const row = ws.getRow(4 + i)
    row.getCell(1).value = r.name
    row.getCell(2).value = r.website
    row.getCell(3).value = r.segmentation
    row.getCell(4).value = r.salesReps
    const flag = row.getCell(5)
    flag.value = r.onAnomaly ? 'YES' : 'NO'
    if (r.onAnomaly) flag.font = { bold: true, color: { argb: 'FFB00020' } }
    row.getCell(6).value = r.skuCount
    const pct = row.getCell(7)
    pct.value = r.avgDiscount ?? 0
    pct.numFmt = '0%'
    row.getCell(8).value = r.comments
  })

  ws.columns = [
    { width: 22 }, { width: 34 }, { width: 14 }, { width: 22 },
    { width: 30 }, { width: 14 }, { width: 22 }, { width: 60 }, { width: 24 },
  ]

  // --- Détail -----------------------------------------------------------
  const detail = wb.addWorksheet('Détail')
  detail.addRow(data.detailHeader)
  const head = detail.getRow(1)
  head.font = { bold: true }
  head.alignment = { wrapText: true, vertical: 'middle' }
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } }
    c.border = BORDER
  })
  data.detailRows.forEach((r) => detail.addRow(r))
  detail.views = [{ state: 'frozen', ySplit: 1 }]
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.detailHeader.length } }
  // 20 colonnes : 12 RRP, 13 prix barré, 14 prix du site (montants) ; 15 remise observée, 16 remise autorisée (pourcentages).
  const widths = [12, 20, 13, 18, 44, 34, 12, 20, 24, 8, 10, 12, 12, 12, 12, 12, 28, 14, 12, 14]
  widths.forEach((w, i) => (detail.getColumn(i + 1).width = w))
  for (const col of [12, 13, 14]) detail.getColumn(col).numFmt = '#,##0.00'
  detail.getColumn(15).numFmt = '0.0%'
  detail.getColumn(16).numFmt = '0%'

  const buffer = await wb.xlsx.writeBuffer()
  downloadBlob(
    data.fileName,
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  )
}


/**
 * Historique des prix en Excel : une ligne par retailer et produit, puis un prix par scan, puis la remise par rapport au RRP.
 * Il couvre tous les scans depuis le premier, sans filtre de saison. Filtrable (retailer, SKU, saison, statut) ; les scans où la fiche n'a pas été vue restent vides.
 */
export async function downloadHistory(data: HistoryExport, fileName: string): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'VEJA – Suivi des prix'
  const ws = wb.addWorksheet('Price history')
  const base = ['Retailer', 'Segmentation', 'Sales rep', 'Page title', 'SKU', 'Model', 'Color', 'Season', 'Status', 'Currency', 'RRP', 'Allowed discount']
  // Une colonne par scan, du premier au dernier : « 2026-11-20 12:39 ».
  const label = (iso: string) => new Date(iso).toLocaleString('sv-SE').slice(0, 16)
  const head = [...base, ...data.scans.map((a) => `Price ${label(a)}`), ...data.scans.map((a) => `Discount ${label(a)}`)]
  const headerRow = ws.addRow(head)
  headerRow.font = { bold: true }
  headerRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } }
    c.border = BORDER
    c.alignment = { wrapText: true, vertical: 'middle' }
  })
  headerRow.height = 32
  for (const r of data.rows) {
    const discounts = r.prices.map((p) => (p !== null && r.rrp ? Math.max(0, 1 - p / r.rrp) : null))
    const row = ws.addRow([r.retailer, r.segmentation, r.salesReps, r.title, r.sku, r.model, r.color, r.season, r.proof === 'confirmed' ? 'Confirmed' : 'To check', r.currency, r.rrp, r.allowedPct === null ? '' : r.allowedPct / 100, ...r.prices, ...discounts])
    row.getCell(11).numFmt = '0.00'
    row.getCell(12).numFmt = '0%'
    data.scans.forEach((_, i) => {
      row.getCell(base.length + 1 + i).numFmt = '0.00'
      row.getCell(base.length + 1 + data.scans.length + i).numFmt = '0.0%'
    })
    if (r.proof !== 'confirmed') row.font = { italic: true, color: { argb: 'FF808080' } }
  }
  ws.columns = [{ width: 22 }, { width: 14 }, { width: 20 }, { width: 40 }, { width: 13 }, { width: 22 }, { width: 22 }, { width: 9 }, { width: 11 }, { width: 9 }, { width: 10 }, { width: 11 }, ...data.scans.map(() => ({ width: 16 })), ...data.scans.map(() => ({ width: 16 }))]
  ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } }
  const buffer = await wb.xlsx.writeBuffer()
  downloadBlob(fileName, new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}
