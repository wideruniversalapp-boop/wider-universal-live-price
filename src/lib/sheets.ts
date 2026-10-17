import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ImportRow } from './importer';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20000;

export async function readSpreadsheet(file: File): Promise<ImportRow[]> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File is larger than 10 MB.');
  const name = file.name.toLowerCase();
  let rows: ImportRow[];
  if (name.endsWith('.csv')) {
    const text = await file.text();
    const parsed = Papa.parse<ImportRow>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
    if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
    rows = parsed.data;
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellFormula: false, cellHTML: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('The workbook has no sheets.');
    rows = XLSX.utils.sheet_to_json<ImportRow>(sheet, { defval: '', raw: false });
  } else {
    throw new Error('Unsupported file type. Upload a .csv or .xlsx file.');
  }
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`File has ${rows.length} rows; the limit is ${MAX_IMPORT_ROWS}.`);
  return rows;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Neutralises spreadsheet formula injection in exported text cells. */
function safeCell(v: unknown): unknown {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function exportRows(rows: Record<string, unknown>[], columns: string[], fileName: string, format: 'xlsx' | 'csv') {
  const clean = rows.map((r) => Object.fromEntries(columns.map((c) => [c, safeCell(r[c] ?? '')])));
  if (format === 'csv') {
    const csv = Papa.unparse(clean, { columns });
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
  } else {
    const ws = XLSX.utils.json_to_sheet(clean, { header: columns });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileName}.xlsx`);
  }
}
