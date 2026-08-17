import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History, RefreshCw, Wrench } from 'lucide-react';
import {
  getPropertyHistory,
  type PropertyComponentHistory,
  type PropertyHistory,
} from '../../services/platform/propertyHistoryService';

interface Props {
  propertyId: string;
  agencyId?: string;
}

function display(value: string): string {
  return value ? value.replaceAll('_', ' ') : 'not recorded';
}

const ComponentHistoryRow: React.FC<{ group: PropertyComponentHistory }> = ({ group }) => {
  const [open, setOpen] = useState(false);
  const latest = group.observations[group.observations.length - 1];
  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 text-slate-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {group.areaName}
          </div>
          <div className="mt-1 font-semibold text-slate-900 dark:text-white">
            {group.componentName}
          </div>
          {latest && (
            <div className="mt-1 text-xs text-slate-500">
              Latest: {display(latest.conditionCategory)} condition ·{' '}
              {display(latest.cleanlinessCategory)} cleanliness · {display(latest.workingStatus)} working ·{' '}
              {display(latest.testStatus)} test
            </div>
          )}
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>
            {group.observations.length} immutable observation
            {group.observations.length === 1 ? '' : 's'}
          </div>
          <div>
            {group.maintenance.length} linked maintenance item
            {group.maintenance.length === 1 ? '' : 's'}
          </div>
        </div>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 p-4 dark:border-slate-800">
          <div className="space-y-3">
            {group.observations.map((observation) => (
              <div
                key={`${observation.reportId}-${observation.reportVersionId}`}
                className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">
                    {observation.reportType} ·{' '}
                    {observation.inspectionDate ||
                      observation.versionCreatedAt ||
                      'date not recorded'}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">
                    {observation.reportVersionId}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <div>
                    <span className="text-slate-400">Condition</span>
                    <div className="font-medium capitalize">
                      {display(observation.conditionCategory)}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400">Cleanliness</span>
                    <div className="font-medium capitalize">
                      {display(observation.cleanlinessCategory)}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400">Working</span>
                    <div className="font-medium capitalize">
                      {display(observation.workingStatus)}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400">Test</span>
                    <div className="font-medium capitalize">{display(observation.testStatus)}</div>
                  </div>
                </div>
                {observation.commentary && (
                  <p className="mt-2 leading-5 text-slate-600 dark:text-slate-300">
                    {observation.commentary}
                  </p>
                )}
                {observation.evidencePhotoIds.length > 0 && (
                  <div className="mt-2 text-[11px] text-slate-400">
                    Evidence IDs: {observation.evidencePhotoIds.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
          {group.maintenance.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                <Wrench className="h-3.5 w-3.5" /> Linked Maintenance
              </div>
              <div className="space-y-2">
                {group.maintenance.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">{item.title}</span>
                      <span className="capitalize">{display(item.status)}</span>
                    </div>
                    <div className="mt-1 text-[11px] opacity-75">
                      {item.category} · {item.priority}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PropertyHistoryPanel: React.FC<Props> = ({ propertyId, agencyId }) => {
  const [history, setHistory] = useState<PropertyHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await getPropertyHistory(propertyId, agencyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Property history could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [propertyId, agencyId]);

  const groups = useMemo(() => {
    if (!history) return [];
    const query = filter.trim().toLowerCase();
    return query
      ? history.components.filter((group) =>
          `${group.areaName} ${group.componentName}`.toLowerCase().includes(query),
        )
      : history.components;
  }, [filter, history]);

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-5 dark:border-slate-800 dark:bg-slate-950/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-blue-600" />
            <h2 className="font-bold text-slate-900 dark:text-white">
              Immutable Property & Component History
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Read-only history assembled from immutable report versions and linked Maintenance records.
            Historical reports are never rewritten by this view.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          {error}
        </div>
      )}
      {loading && !history ? (
        <div className="py-8 text-center text-xs text-slate-500">Loading immutable history...</div>
      ) : (
        history && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-2xl font-bold">{history.inspections.length}</div>
                <div className="text-xs text-slate-500">reports with immutable versions</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-2xl font-bold">{history.components.length}</div>
                <div className="text-xs text-slate-500">stable component histories</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-2xl font-bold">{history.maintenance.length}</div>
                <div className="text-xs text-slate-500">property maintenance records</div>
              </div>
            </div>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by area or component..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
            <div className="space-y-2">
              {groups.length ? (
                groups.map((group) => <ComponentHistoryRow key={group.stableKey} group={group} />)
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                  No component history matches the current filter.
                </div>
              )}
            </div>
          </>
        )
      )}
    </section>
  );
};

export default PropertyHistoryPanel;
