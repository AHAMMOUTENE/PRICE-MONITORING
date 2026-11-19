import { downloadBlob } from './format'

export type TemplateKind = 'accounts' | 'catalog'

/**
 * Modèles de fichiers à importer. Les en-têtes sont ceux que le service d'import reconnaît :
 * ceux du fichier de suivi « FOLLOW UP IMAGE ONLINE » pour les comptes, ceux de l'export catalogue pour les produits.
 * Deux lignes d'exemple montrent le format attendu.
 */
const TEMPLATES: Record<TemplateKind, { sheet: string; fileName: string; header: string[]; rows: (string | number)[][]; widths: number[] }> = {
  accounts: {
    sheet: 'Accounts',
    fileName: 'template_accounts.xlsx',
    header: ['STORE NAME', 'STORE WEBSITE', 'CURRENCY', 'SEGMENTATION', 'SALES REP'],
    rows: [
      ['Example Store', 'https://www.example-store.com/fr/veja', 'EUR', 'T1', 'Marcel, Bastian'],
      ['Another Shop', 'https://www.another-shop.co.uk/brands/veja', 'GBP', 'T2A', 'Nadine'],
    ],
    widths: [26, 46, 10, 14, 22],
  },
  catalog: {
    sheet: 'Catalog',
    fileName: 'template_catalog.xlsx',
    header: ['SKU', 'MODEL', 'MATERIAL', 'COLOR', 'SEASON', 'MAX DISCOUNT %', 'RRP EUR', 'RRP GBP', 'RRP USD', 'WHOLESALE EUR'],
    rows: [
      ['CP0501215A', 'CAMPO', 'LEATHER (05)', 'Black white', 'C/O', 0, 140, 125, 165, 58.5],
      ['EE4323079A', 'MONTANA', 'ROPE', 'Black', 'AW26', 20, 75, 65, 90, 31.5],
    ],
    widths: [14, 16, 18, 24, 10, 16, 10, 10, 10, 16],
  },
}

/** Génère le modèle Excel et le télécharge. La bibliothèque est chargée à la demande. */
export async function downloadTemplate(kind: TemplateKind): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const tpl = TEMPLATES[kind]
  const wb = new ExcelJS.Workbook()
  wb.creator = 'VEJA – Suivi des prix'
  const ws = wb.addWorksheet(tpl.sheet)
  const head = ws.addRow(tpl.header)
  head.font = { bold: true }
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6D9EC' } }
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })
  for (const r of tpl.rows) {
    const row = ws.addRow(r)
    row.font = { color: { argb: 'FF808080' }, italic: true }
  }
  tpl.widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const buffer = await wb.xlsx.writeBuffer()
  downloadBlob(tpl.fileName, new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}
