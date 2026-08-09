import React, { useRef, useState } from 'react';
import { PreviousReportAttachment, ReportData } from '../../../types';
import { PropertyRecord } from '../../../types/platform';
import { Building, FileText, Upload, Trash2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { validatePreviousReportFile } from '../../../services/validationService';

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
  const previousReportInputRef = useRef<HTMLInputElement>(null);
  const [previousReportError, setPreviousReportError] = useState<string | null>(null);

  const handlePreviousReportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPreviousReportError(null);
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const validationErrors = validatePreviousReportFile(file);

    if (validationErrors.length > 0) {
      setPreviousReportError(validationErrors.join(' '));
      return;
    }

    const attachment: PreviousReportAttachment = {
      id: Date.now().toString(),
      file,
      name: file.name,
      mimeType: file.type,
    };

    onUpdateReport({ previousReport: attachment });
  };

  const handleRemovePreviousReport = () => {
    onUpdateReport({ previousReport: undefined, previousReportNotes: '' });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Building className="h-5 w-5 text-blue-600" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Property & Inspection Metadata
          </h2>
          {report.lifecycleStatus && (
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase">
              {report.lifecycleStatus.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 font-semibold"
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <span>{isExpanded ? 'Hide Details' : 'Show Details'}</span>
        </button>
      </div>

      {importMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>{importMessage}</span>
        </div>
      )}

      {/* Property Import Bar */}
      {!disabled && properties.length > 0 && (
        <div className="rounded-xl bg-slate-50 p-3 border border-slate-200/80 dark:bg-slate-800/60 dark:border-slate-700 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0">Property Catalogue:</span>
            <select
              value={selectedPropertyId}
              onChange={(e) => onSelectPropertyId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="">-- Select Property from Platform --</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address} ({p.bedrooms} bed, {p.bathrooms} bath)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onImportProperty()}
              disabled={!selectedPropertyId}
              className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-2xs"
            >
              Pull Details & Seed Areas
            </button>
            {report.rooms.length === 0 && (
              <button
                onClick={onSeedDefaultRooms}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Seed Default Areas
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Metadata Form */}
      {isExpanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs pt-1">
          <div className="sm:col-span-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Property Address
            </label>
            <input
              type="text"
              value={report.propertyAddress || ''}
              onChange={(e) => onUpdateReport({ propertyAddress: e.target.value })}
              disabled={disabled}
              placeholder="e.g. 12 Smith Street, Perth WA 6000"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Inspection Date
            </label>
            <input
              type="date"
              value={report.inspectionDate || ''}
              onChange={(e) => onUpdateReport({ inspectionDate: e.target.value })}
              disabled={disabled}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Report Type
            </label>
            <select
              value={report.reportType || 'Property Condition Report'}
              onChange={(e) => onUpdateReport({ reportType: e.target.value })}
              disabled={disabled}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="Property Condition Report">Entry PCR</option>
              <option value="Routine Inspection">Routine Inspection</option>
              <option value="Exit Inspection">Exit Inspection</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Client Name
            </label>
            <input
              type="text"
              value={report.clientName || ''}
              onChange={(e) => onUpdateReport({ clientName: e.target.value })}
              disabled={disabled}
              placeholder="Client / Property Owner"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Tenant Name
            </label>
            <input
              type="text"
              value={report.tenantName || ''}
              onChange={(e) => onUpdateReport({ tenantName: e.target.value })}
              disabled={disabled}
              placeholder="Tenant Name(s)"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Inspector / Agent
            </label>
            <input
              type="text"
              value={report.agentName || ''}
              onChange={(e) => onUpdateReport({ agentName: e.target.value })}
              disabled={disabled}
              placeholder="Inspector Name"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Agency Name
            </label>
            <input
              type="text"
              value={report.agentCompany || ''}
              onChange={(e) => onUpdateReport({ agentCompany: e.target.value })}
              disabled={disabled}
              placeholder="Agency / Company"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
      )}

      {/* Previous Report Attachment Section */}
      {isExpanded && (
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <FileText size={14} className="text-blue-600" />
              Previous Baseline Report Comparison Reference
            </span>

            {!disabled && !report.previousReport && (
              <button
                onClick={() => previousReportInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400"
              >
                <Upload size={13} />
                <span>Attach Previous PCR / Routine PDF</span>
              </button>
            )}

            <input
              type="file"
              ref={previousReportInputRef}
              onChange={handlePreviousReportChange}
              accept="application/pdf,image/jpeg,image/png"
              className="hidden"
            />
          </div>

          {previousReportError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold">{previousReportError}</p>
          )}

          {report.previousReport ? (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-xs">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-blue-600" />
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200">{report.previousReport.name}</p>
                  <p className="text-[10px] text-slate-500">Previous inspection baseline attached for comparison</p>
                </div>
              </div>

              {!disabled && (
                <button
                  onClick={handleRemovePreviousReport}
                  className="p-1 text-slate-400 hover:text-rose-600"
                  title="Remove previous report attachment"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
              No previous report attached. Attach a baseline report if conducting Routine or Exit comparisons.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
