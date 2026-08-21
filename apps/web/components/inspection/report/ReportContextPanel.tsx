import React, { useState } from 'react';
import { ReportData } from '../../../types';
import { PropertyRecord } from '../../../types/platform';
import { Building, CheckCircle2, ChevronDown, ChevronUp, History, ShieldCheck } from 'lucide-react';

interface ReportContextPanelProps {
  report: ReportData;
  properties: PropertyRecord[];
  selectedPropertyId: string;
  onSelectPropertyId: (id: string) => void;
  onImportProperty: (id?: string) => void;
  onSeedDefaultRooms: () => void;
  onUpdateReport: (patch: Partial<ReportData>) => void;
  importMessage?: string;
  disabled?: boolean;
}

export const ReportContextPanel: React.FC<ReportContextPanelProps> = ({
  report,
  properties,
  selectedPropertyId,
  onSelectPropertyId,
  onImportProperty,
  onSeedDefaultRooms,
  onUpdateReport,
  importMessage,
  disabled = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Building className="h-5 w-5 text-blue-600" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Property & Inspection Metadata</h2>
          {report.lifecycleStatus && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {report.lifecycleStatus.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <span>{isExpanded ? 'Hide Details' : 'Show Details'}</span>
        </button>
      </div>

      {importMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>{importMessage}</span>
        </div>
      )}

      {!disabled && properties.length > 0 && !report.inspectionJobId && (
        <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/60 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 font-bold text-slate-700 dark:text-slate-300">Property Catalogue:</span>
            <select
              value={selectedPropertyId}
              onChange={(event) => onSelectPropertyId(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="">-- Select Property from Platform --</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.address} ({property.bedrooms} bed, {property.bathrooms} bath)
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onImportProperty()}
              disabled={!selectedPropertyId}
              className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              Pull Details & Seed Areas
            </button>
            {report.rooms.length === 0 && (
              <button
                type="button"
                onClick={onSeedDefaultRooms}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Seed Default Areas
              </button>
            )}
          </div>
        </div>
      )}

      {report.inspectionJobId && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-bold">Server-authoritative report context</div>
            <div className="mt-0.5">Property, tenancy, published Template Version, Property Layout Version and any required baseline were bound when Inspection Job {report.inspectionJobId} created this report.</div>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="grid grid-cols-1 gap-3 pt-1 text-xs sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Property Address</label>
            <input type="text" value={report.propertyAddress || ''} onChange={(event) => onUpdateReport({ propertyAddress: event.target.value })} disabled={disabled || Boolean(report.inspectionJobId)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Inspection Date</label>
            <input type="date" value={report.inspectionDate || ''} onChange={(event) => onUpdateReport({ inspectionDate: event.target.value })} disabled={disabled} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Report Type</label>
            <input value={report.reportType || ''} disabled className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Client Name</label>
            <input type="text" value={report.clientName || ''} onChange={(event) => onUpdateReport({ clientName: event.target.value })} disabled={disabled} placeholder="Client / Property Owner" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Tenant Name</label>
            <input type="text" value={report.tenantName || ''} onChange={(event) => onUpdateReport({ tenantName: event.target.value })} disabled={disabled || Boolean(report.tenancyId)} placeholder="Tenant Name(s)" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Inspector / Agent</label>
            <input type="text" value={report.agentName || ''} onChange={(event) => onUpdateReport({ agentName: event.target.value })} disabled={disabled} placeholder="Inspector Name" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Agency Name</label>
            <input type="text" value={report.agentCompany || ''} onChange={(event) => onUpdateReport({ agentCompany: event.target.value })} disabled={disabled} placeholder="Agency / Company" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300">
            <History size={14} className="text-blue-600" />
            Canonical Baseline / Historical Reference
          </div>
          {report.baselineReportId ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
              <div className="font-semibold text-slate-800 dark:text-slate-100">Baseline report {report.baselineReportId}</div>
              <div className="mt-1 text-[11px] text-slate-500">Immutable version: {report.baselineReportVersionId || 'legacy mapping pending'} · Quality: {report.baselineQuality || 'structured'}</div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              No baseline is required or currently linked. Historical reports are uploaded and retained under the Property Documents workspace. Exit and comparison reports bind an immutable baseline through the server workflow rather than a temporary browser attachment.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
