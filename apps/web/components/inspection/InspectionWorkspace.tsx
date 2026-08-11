import React from 'react';
import { PreviousReportAttachment, Room } from '../../types';
import { AreaNavigator } from './AreaNavigator';
import { AreaWorkspace } from './AreaWorkspace';
import { Building, Plus } from 'lucide-react';

interface InspectionWorkspaceProps {
  areas: Room[];
  activeAreaId: string;
  onSelectArea: (areaId: string) => void;
  onUpdateArea: (areaId: string, updatedArea: Room) => void;
  onAddArea: (areaName: string) => void;
  onRemoveArea: (areaId: string) => void;
  previousReport?: PreviousReportAttachment;
  previousReportNotes?: string;
  agencyId?: string;
  readOnly?: boolean;
}

export const InspectionWorkspace: React.FC<InspectionWorkspaceProps> = ({
  areas,
  activeAreaId,
  onSelectArea,
  onUpdateArea,
  onAddArea,
  onRemoveArea,
  previousReport,
  previousReportNotes,
  agencyId,
  readOnly = false,
}) => {
  const activeArea = areas.find((a) => a.id === activeAreaId) || areas[0] || null;

  if (areas.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
        <Building className="mx-auto h-12 w-12 text-slate-400 mb-3 opacity-60" />
        <h3 className="text-base font-bold text-slate-900 dark:text-white">No Inspection Areas Configured</h3>
        <p className="mt-1 text-xs max-w-sm mx-auto">
          Add standard property area templates (Kitchen, Lounge, Bathroom) to start recording inspections.
        </p>
        {!readOnly && (
          <button
            onClick={() => onAddArea('Entrance / Entry')}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-md"
          >
            <Plus size={16} />
            <span>Add First Inspection Area</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
      {/* Area Navigator (Sidebar) */}
      <div className="md:col-span-1">
        <AreaNavigator
          areas={areas}
          activeAreaId={activeArea?.id || ''}
          onSelectArea={onSelectArea}
          onAddArea={onAddArea}
          disabled={readOnly}
        />
      </div>

      {/* Main Area Workspace */}
      <div className="md:col-span-3">
        {activeArea ? (
          <AreaWorkspace
            key={activeArea.id}
            area={activeArea}
            onUpdateArea={(updatedArea) => onUpdateArea(activeArea.id, updatedArea)}
            onDeleteArea={() => onRemoveArea(activeArea.id)}
            previousReport={previousReport}
            previousReportNotes={previousReportNotes}
            agencyId={agencyId}
            readOnly={readOnly}
          />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Select an area from the navigation panel to view and edit component assessments.
          </div>
        )}
      </div>
    </div>
  );
};
