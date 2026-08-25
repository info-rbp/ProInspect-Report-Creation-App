import readXlsxFile, { type CellValue, type SheetData } from 'read-excel-file/browser';

export type SpreadsheetValue = string | number | boolean | null;

export interface ParsedSpreadsheetRows {
  sheetName: string;
  rows: Array<Record<string, SpreadsheetValue>>;
}

export function parseCsvRows(text: string): SheetData {
  const rows: SheetData = [];
  let row: Array<string | null> = [];
  let value = '';
  let quoted = false;

  const pushValue = () => {
    row.push(value.length ? value : null);
    value = '';
  };
  const pushRow = () => {
    pushValue();
    if (row.some((cell) => cell !== null)) rows.push(row);
    row = [];
  };

  const source = text.replace(/^\uFEFF/u, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"' && value.length === 0) quoted = true;
    else if (character === ',') pushValue();
    else if (character === '\n') pushRow();
    else if (character !== '\r') value += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted value.');
  if (value.length || row.length) pushRow();
  return rows;
}

function normaliseValue(value: CellValue | null): SpreadsheetValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof globalThis.Date) return value.toISOString();
  return String(value);
}

export function spreadsheetRowsToRecords(data: SheetData): Array<Record<string, SpreadsheetValue>> {
  const [headerRow, ...dataRows] = data;
  if (!headerRow) return [];
  const usedHeaders = new Map<string, number>();
  const headers = headerRow.map((value, index) => {
    const base = String(value ?? '').trim() || `column_${index + 1}`;
    const count = (usedHeaders.get(base) || 0) + 1;
    usedHeaders.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });

  return dataRows
    .filter((row) => row.some((value) => value !== null && String(value).trim() !== ''))
    .map((row) => Object.fromEntries(headers.map((header, index) => [
      header,
      normaliseValue(row[index] ?? null),
    ])));
}

export async function readSpreadsheetRows(
  file: File,
  preferredSheet?: string,
): Promise<ParsedSpreadsheetRows> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'xls') {
    throw new Error('Legacy XLS files are not accepted. Export the file as XLSX or CSV and try again.');
  }
  if (extension !== 'xlsx' && extension !== 'csv') {
    throw new Error('Spreadsheet imports must be XLSX or CSV files.');
  }

  if (extension === 'csv') {
    return { sheetName: 'CSV', rows: spreadsheetRowsToRecords(parseCsvRows(await file.text())) };
  }

  const sheets = await readXlsxFile(await file.arrayBuffer());
  const selected = (preferredSheet ? sheets.find((sheet) => sheet.sheet === preferredSheet) : undefined)
    || sheets[0];
  if (!selected) throw new Error('Spreadsheet does not contain a readable worksheet.');
  return { sheetName: selected.sheet, rows: spreadsheetRowsToRecords(selected.data) };
}
