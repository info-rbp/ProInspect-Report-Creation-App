import * as XLSX from 'xlsx';
import type { PriceBookImport } from '../../types/platform';
import { apiRequest } from '../apiClient';

const CHUNK_SIZE = 8 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

function mimeType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type.toLowerCase();
  const extension = file.name.toLowerCase().split('.').pop() || '';
  const inferred = MIME_BY_EXTENSION[extension];
  if (!inferred) throw new Error(`Unsupported price-book file type: .${extension || 'unknown'}`);
  return inferred;
}

async function digest(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function uploadChunks(file: File, uploadUrl: string, contentType: string): Promise<void> {
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': contentType,
        'content-range': `bytes ${start}-${end - 1}/${file.size}`,
      },
      body: file.slice(start, end),
    });
    if (response.status === 308) {
      const range = response.headers.get('range');
      start = range ? Number(range.split('-').pop()) + 1 : end;
      continue;
    }
    if (!response.ok) throw new Error(`Price-book upload failed with ${response.status}.`);
    start = file.size;
  }
}

export interface PreparedPriceBookSpreadsheet {
  file: File;
  fileName: string;
  contentType: string;
  fileSize: number;
  sha256: string;
  sheetName: string;
  rows: Array<Record<string, string | number | boolean | null>>;
}

export async function preparePriceBookSpreadsheet(
  file: File,
  preferredSheet?: string,
): Promise<PreparedPriceBookSpreadsheet> {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false, raw: false });
  const sheetName =
    (preferredSheet && workbook.SheetNames.includes(preferredSheet) ? preferredSheet : undefined) ||
    workbook.SheetNames[0];
  if (!sheetName) throw new Error('Spreadsheet does not contain a worksheet.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Selected worksheet could not be read.');
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null>>(sheet, {
    defval: null,
    raw: false,
  });
  if (!rows.length) throw new Error('Spreadsheet does not contain any data rows.');
  if (rows.length > 20_000) throw new Error('Price-book imports are limited to 20,000 data rows.');
  return {
    file,
    fileName: file.name,
    contentType: mimeType(file),
    fileSize: file.size,
    sha256: await digest(file),
    sheetName,
    rows,
  };
}

export async function uploadPriceBookSpreadsheet(
  prepared: PreparedPriceBookSpreadsheet,
  proposedPriceBookName?: string,
): Promise<PriceBookImport> {
  const session = await apiRequest<{
    uploadId: string;
    objectPath: string;
    resumableUploadUrl: string;
    expiresAt: string;
  }>(agencyId(), '/api/v1/price-book-imports/upload-session', {
    method: 'POST',
    body: {
      fileName: prepared.fileName,
      contentType: prepared.contentType,
      fileSize: prepared.fileSize,
      sha256: prepared.sha256,
    },
  });
  await uploadChunks(prepared.file, session.resumableUploadUrl, prepared.contentType);
  return apiRequest<PriceBookImport>(
    agencyId(),
    `/api/v1/price-book-imports/${encodeURIComponent(session.uploadId)}/complete`,
    {
      method: 'POST',
      body: {
        sheetName: prepared.sheetName,
        proposedPriceBookName,
        rows: prepared.rows,
      },
    },
  );
}
