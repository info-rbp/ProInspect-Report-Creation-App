import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';
import {
  importPropertyCandidates,
  parsePropertyCsv,
  PROPERTY_CSV_TEMPLATE,
  type PropertyImportCandidate,
} from '../../services/platform/propertyBulkImportService';

function downloadTemplate() {
  const blob = new Blob([PROPERTY_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'proinspect-property-import-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

const PropertyBulkImportPage: React.FC = () => {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<PropertyImportCandidate[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    setCandidates(parsePropertyCsv(await file.text()));
    setError(null);
  };

  const importAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await importPropertyCandidates(DEFAULT_AGENCY_ID, candidates);
      if (created.length === 1) navigate(`/app/admin/properties/${created[0].id}`);
      else navigate('/app/admin/properties');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Portfolio import failed.');
    } finally {
      setBusy(false);
    }
  };

  const invalid = candidates.filter((candidate) => candidate.errors.length);

  return <div className="mx-auto max-w-7xl space-y-6 pb-16">
    <div><Link to="/app/admin/properties" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500"><ArrowLeft size={14} /> Back to Property Portfolio</Link><h1 className="mt-3 text-2xl font-black">Bulk Property Onboarding</h1><p className="mt-1 text-sm text-slate-500">Review a CSV portfolio before any property is created. Imported properties receive classification, tenancy/owner seed data and a suitable versioned starting layout.</p></div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><FileSpreadsheet size={20} /></div><div><h2 className="font-bold">Portfolio CSV</h2><p className="text-xs text-slate-500">Address is required. Other fields can be completed later in the Property Workspace.</p></div></div><button onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><Download size={14} /> Download Template</button></div>
      <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Upload size={18} /> {fileName || 'Choose CSV file'}<input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} /></label>
    </section>
    {candidates.length > 0 && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 p-4"><div><h2 className="font-bold">Import Review</h2><p className="text-xs text-slate-500">{candidates.length} properties · {invalid.length} rows require attention</p></div><button disabled={busy || invalid.length > 0} onClick={() => void importAll()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><CheckCircle2 size={15} /> {busy ? 'Importing...' : `Import ${candidates.length} Properties`}</button></div><div className="overflow-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-3">Row</th><th>Address</th><th>Classification</th><th>Ownership</th><th>Owner</th><th>Tenant</th><th>Validation</th></tr></thead><tbody className="divide-y divide-slate-100">{candidates.map((candidate) => <tr key={candidate.row}><td className="p-3">{candidate.row}</td><td><b>{candidate.address || 'Missing address'}</b><div className="text-slate-400">{candidate.suburb} {candidate.postcode}</div></td><td className="capitalize">{candidate.propertyUse.replaceAll('_', ' ')}<div className="text-slate-400">{candidate.physicalPropertyType.replaceAll('_', ' ')}</div></td><td className="capitalize">{candidate.ownershipStructure.replaceAll('_', ' ')}</td><td>{candidate.ownerName || 'Not provided'}</td><td>{candidate.tenantName || 'Vacant / not provided'}</td><td>{candidate.errors.length ? <span className="font-semibold text-rose-600">{candidate.errors.join(' ')}</span> : <span className="font-semibold text-emerald-600">Ready</span>}</td></tr>)}</tbody></table></div></section>}
  </div>;
};

export default PropertyBulkImportPage;
