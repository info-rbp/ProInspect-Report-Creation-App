import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Play, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { bulkImportClients, type ClientBulkImportResult } from '../../services/platform/clientManagementService';

interface PreparedImport {
  fileName: string;
  sheetName: string;
  rows: Array<Record<string, string | number | boolean | null>>;
  headers: string[];
}

const EXPECTED_COLUMNS = [
  'client', 'legalName', 'tradingName', 'clientType', 'entityType', 'abn', 'acn',
  'primaryContactName', 'primaryEmail', 'primaryPhone', 'accountsEmail', 'billingMethod',
  'paymentTermsDays', 'xeroContactId', 'shopifyCustomerId', 'propertyId', 'relationshipType',
  'propertyManagerApprovalLimit', 'landlordApprovalThreshold', 'emergencyAuthorisationLimit',
] as const;

function statusClass(status: ClientBulkImportResult['results'][number]['status']): string {
  if (status === 'created' || status === 'ready' || status === 'linked_existing') return 'bg-emerald-50 text-emerald-700';
  if (status === 'review_required') return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

const ClientBulkImportPage: React.FC = () => {
  const [prepared, setPrepared] = useState<PreparedImport>();
  const [result, setResult] = useState<ClientBulkImportResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [committed, setCommitted] = useState(false);

  const missingSuggestedColumns = useMemo(() => {
    if (!prepared) return [];
    const headerSet = new Set(prepared.headers.map((header) => header.toLowerCase()));
    return EXPECTED_COLUMNS.filter((column) => !headerSet.has(column.toLowerCase()));
  }, [prepared]);

  const prepare = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(''); setResult(undefined); setCommitted(false);
    try {
      const extension = file.name.toLowerCase().split('.').pop();
      if (!['xlsx', 'xls', 'csv'].includes(extension || '')) throw new Error('Client imports must be XLSX, XLS or CSV files.');
      if (file.size > 25 * 1024 * 1024) throw new Error('Client import files are limited to 25 MB.');
      const bytes = await file.arrayBuffer();
      const workbook = XLSX.read(bytes, { type: 'array', cellDates: false, raw: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName || !workbook.Sheets[sheetName]) throw new Error('Spreadsheet does not contain a readable worksheet.');
      const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null>>(workbook.Sheets[sheetName], { defval: null, raw: false });
      if (!rows.length) throw new Error('Spreadsheet does not contain any Client rows.');
      if (rows.length > 5_000) throw new Error('Client imports are limited to 5,000 rows per batch.');
      const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      setPrepared({ fileName: file.name, sheetName, rows, headers });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Spreadsheet could not be prepared.');
    } finally { setBusy(false); }
  };

  const run = async (dryRun: boolean) => {
    if (!prepared) return;
    setBusy(true); setError('');
    try {
      const next = await bulkImportClients(prepared.rows, dryRun);
      setResult(next);
      setCommitted(!dryRun);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Client import could not be processed.');
    } finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <div className="flex items-center gap-3"><Link to="/app/admin/clients" className="rounded-lg border border-slate-200 p-2 text-slate-600"><ArrowLeft size={16}/></Link><div><div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Portfolio onboarding</div><h1 className="text-3xl font-black text-slate-950">Bulk Client Import</h1><p className="mt-1 text-sm text-slate-500">Review spreadsheet rows before they create Client Accounts, Contacts and Property relationships.</p></div></div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center hover:border-blue-300">
          <Upload size={26} className="text-slate-400"/><div className="mt-3 font-black text-slate-900">Choose XLSX, XLS or CSV</div><div className="mt-1 text-xs text-slate-500">Up to 5,000 rows. Existing Clients are matched before creation.</div><input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={busy} onChange={(event) => void prepare(event.target.files?.[0])}/>
        </label>
        <div className="rounded-2xl bg-slate-950 p-5 text-white"><div className="flex items-center gap-2 font-black"><FileSpreadsheet size={18}/> Recommended columns</div><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300">{EXPECTED_COLUMNS.map((column) => <span key={column}>{column}</span>)}</div></div>
      </div>
      {prepared && <div className="mt-5 rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-bold">{prepared.fileName}</div><div className="text-xs text-slate-400">Sheet {prepared.sheetName} · {prepared.rows.length} data rows · {prepared.headers.length} columns</div></div><div className="flex gap-2"><button disabled={busy} onClick={() => void run(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"><Play size={15}/> Validate dry run</button><button disabled={busy || !result || result.reviewRequired > 0 || result.rejected > 0} onClick={() => void run(false)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"><CheckCircle2 size={15}/> Commit reviewed rows</button></div></div>{missingSuggestedColumns.length > 0 && <div className="mt-3 text-xs text-slate-500">Optional/recommended columns not present: {missingSuggestedColumns.join(', ')}.</div>}</div>}
    </section>
    {prepared && <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-4"><h2 className="font-black">Source preview</h2><p className="text-xs text-slate-500">First 25 rows are shown. The server validates every row before committing anything.</p></div><div className="overflow-x-auto"><table className="min-w-max text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{prepared.headers.map((header) => <th key={header} className="px-3 py-2 font-bold">{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{prepared.rows.slice(0,25).map((row,index) => <tr key={index}>{prepared.headers.map((header) => <td key={header} className="max-w-[260px] truncate px-3 py-2 text-slate-600">{row[header] === null ? '' : String(row[header] ?? '')}</td>)}</tr>)}</tbody></table></div></section>}
    {result && <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-4"><div><div className="text-xs text-slate-400">{committed ? 'Created' : 'Ready/new'}</div><div className="text-xl font-black">{committed ? result.created : result.results.filter((row) => row.status === 'ready').length}</div></div><div><div className="text-xs text-slate-400">Existing links</div><div className="text-xl font-black">{committed ? result.linkedExisting : result.results.filter((row) => row.status === 'linked_existing').length}</div></div><div><div className="text-xs text-slate-400">Review required</div><div className="text-xl font-black">{result.reviewRequired}</div></div><div><div className="text-xs text-slate-400">Rejected</div><div className="text-xl font-black">{result.rejected}</div></div></div><div className="max-h-[520px] overflow-auto divide-y divide-slate-100">{result.results.map((row) => <div key={row.row} className="grid gap-2 p-4 md:grid-cols-[80px_160px_1fr]"><div className="font-mono text-xs text-slate-400">Row {row.row}</div><div><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusClass(row.status)}`}>{row.status.replaceAll('_',' ')}</span></div><div className="text-xs text-slate-600">{row.messages.length ? row.messages.join(' · ') : row.clientAccountId ? `Client ${row.clientAccountId}${row.propertyId ? ` · Property ${row.propertyId}` : ''}` : 'Validated.'}</div></div>)}</div></section>}
  </div>;
};

export default ClientBulkImportPage;
