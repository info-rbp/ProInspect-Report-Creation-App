import React, { useMemo, useState } from 'react';
import type { LegacyBaselineComponentMapping, LegacyBaselineSource } from '@pcr/domain';
import { AlertTriangle, ClipboardCopy, Save } from 'lucide-react';
import type { ReportData } from '../../types';
import {
  aggregateToReportData,
  saveLegacyBaselineMapping,
} from '../../services/platform/inspectionReportService';

interface Props {
  report: ReportData;
  onReportChange: (report: ReportData) => void;
}

function starterMappings(report: ReportData): LegacyBaselineComponentMapping[] {
  return report.rooms.flatMap((room) =>
    room.items.map((item) => {
      const operationallyNotApplicable =
        item.workingStatus === 'not_applicable' || item.testStatus === 'not_applicable';
      return {
        areaId: room.id,
        componentId: item.id,
        sourceAreaLabel: room.name,
        sourceComponentLabel: item.name,
        sourceExcerpt: '',
        baseline: {
          conditionCategory: 'unable_to_confirm' as const,
          cleanlinessCategory: 'unable_to_confirm' as const,
          workingStatus: operationallyNotApplicable
            ? ('not_applicable' as const)
            : ('untested' as const),
          testStatus: operationallyNotApplicable
            ? ('not_applicable' as const)
            : ('untested' as const),
          commentary: '',
          defects: [],
          photoReferences: [],
        },
        mappingMethod: 'legacy_mapping' as const,
        confidence: 0.5,
        reviewNote:
          'Reviewed against the legacy Entry source. Replace this note with the basis for the mapping.',
      };
    }),
  );
}

function parseMappings(value: string): LegacyBaselineComponentMapping[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Mappings must be a JSON array.');
  return parsed as LegacyBaselineComponentMapping[];
}

const LegacyBaselineMappingPanel: React.FC<Props> = ({ report, onReportChange }) => {
  const initial = useMemo(() => JSON.stringify(starterMappings(report), null, 2), [report.id]);
  const [sourceType, setSourceType] = useState<LegacyBaselineSource['sourceType']>('pdf');
  const [sourceId, setSourceId] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceObjectPath, setSourceObjectPath] = useState('');
  const [sourceSha256, setSourceSha256] = useState('');
  const [sourceDate, setSourceDate] = useState('');
  const [mappingText, setMappingText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSave = async () => {
    if (!sourceId.trim() || !sourceName.trim()) {
      setMessage('Source ID and source name are required.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const source: LegacyBaselineSource = {
        sourceType,
        sourceId: sourceId.trim(),
        sourceName: sourceName.trim(),
        ...(sourceObjectPath.trim() ? { sourceObjectPath: sourceObjectPath.trim() } : {}),
        ...(sourceSha256.trim() ? { sourceSha256: sourceSha256.trim().toLowerCase() } : {}),
        ...(sourceDate ? { sourceDate } : {}),
      };
      const mappings = parseMappings(mappingText);
      const aggregate = await saveLegacyBaselineMapping(report, source, mappings);
      onReportChange(aggregateToReportData(aggregate));
      setMessage(
        `Saved ${mappings.length} reviewed legacy component mapping${mappings.length === 1 ? '' : 's'}. Run Entry-to-Exit comparison after reviewing every mapped baseline.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Legacy baseline mapping could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">Reviewed Legacy Entry Baseline Required</h3>
          <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
            No structured immutable Entry report was available. Map the legacy Entry source to stable
            Exit components manually. Legacy mappings are confidence-capped and must not infer tenant
            responsibility, causation or liability. Working status can only be mapped as confirmed or
            failed where the legacy source records an actual operational test.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-semibold">
          Source type
          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as LegacyBaselineSource['sourceType'])}
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 text-gray-900"
          >
            <option value="pdf">PDF</option>
            <option value="document">Document</option>
            <option value="manual">Manual record</option>
          </select>
        </label>
        <label className="text-xs font-semibold">
          Source ID
          <input
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            placeholder="e.g. entry-pdf-2025"
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 text-gray-900"
          />
        </label>
        <label className="text-xs font-semibold">
          Source name
          <input
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            placeholder="Original Entry PCR.pdf"
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 text-gray-900"
          />
        </label>
        <label className="text-xs font-semibold">
          Source object path
          <input
            value={sourceObjectPath}
            onChange={(event) => setSourceObjectPath(event.target.value)}
            placeholder="Optional immutable object path"
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 text-gray-900"
          />
        </label>
        <label className="text-xs font-semibold">
          Source SHA-256
          <input
            value={sourceSha256}
            onChange={(event) => setSourceSha256(event.target.value)}
            placeholder="Optional 64-character SHA-256"
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 font-mono text-xs text-gray-900"
          />
        </label>
        <label className="text-xs font-semibold">
          Source date
          <input
            type="date"
            value={sourceDate}
            onChange={(event) => setSourceDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 text-gray-900"
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-xs font-bold uppercase tracking-wide">Reviewed component mapping</label>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(mappingText)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            <ClipboardCopy size={14} /> Copy mapping
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
          A starter mapping uses the stable Exit area/component IDs. Replace source labels, excerpts and
          baseline facts only with information supported by the legacy Entry source. Leave unsupported
          condition/cleanliness facts as unable_to_confirm and operational facts as untested.
          Non-operational components remain not_applicable.
        </p>
        <textarea
          value={mappingText}
          onChange={(event) => setMappingText(event.target.value)}
          spellCheck={false}
          rows={18}
          className="mt-2 w-full rounded-lg border border-amber-300 bg-white p-3 font-mono text-[11px] leading-4 text-gray-900"
        />
      </div>

      {message && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 p-3 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          {message}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50"
        >
          <Save size={15} />
          {saving ? 'Saving Reviewed Mapping...' : 'Save Reviewed Legacy Mapping'}
        </button>
      </div>
    </section>
  );
};

export default LegacyBaselineMappingPanel;
