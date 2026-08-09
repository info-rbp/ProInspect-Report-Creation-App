import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReportData } from '../../types';
import { PropertyRecord } from '../../types/platform';
import { useReportWorkspace } from '../../hooks/inspection/useReportWorkspace';
import { useReportAnalysis } from '../../hooks/inspection/useReportAnalysis';
import { useUnsavedChangesGuard } from '../../hooks/inspection/useUnsavedChangesGuard';
import { ReportContextPanel } from '../inspection/report/ReportContextPanel';
import { ReportAnalysisPanel } from '../inspection/report/ReportAnalysisPanel';
import { ReportCompletenessPanel } from '../inspection/report/ReportCompletenessPanel';
import { ReportActionBar } from '../inspection/report/ReportActionBar';
import { InspectionWorkspace } from '../inspection/InspectionWorkspace';
import { saveReportToDB, loadReportFromDB } from '../../services/storageService';
import { listProperties } from '../../services/platform/propertyService';
import { seedReportFromProperty, seedRoomsFromProperty } from '../../services/platform/propertySeedingService';
import { sanitizeReportData, validateReport } from '../../services/validationService';
import { logAuditEvent } from '../../services/platform/auditService';
import { upsertReportIndexFromReport } from '../../services/platform/reportIndexService';

const IMMUTABLE_REPORT_STATUSES = new Set([
  'approved_for_issue',
  'reviewer_approved',
  'ready_to_issue',
  'issued_to_tenant',
  'tenant_viewed',
  'tenant_submitted',
  'finalisation_ready',
  'finalised',
  'archived',
]);

export const ReportBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { reportId } = useParams<{ reportId: string }>();

  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [importMessage, setImportMessage] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);

  const initialReportData: ReportData = {
    id: reportId && reportId !== 'new' ? reportId : `report-${Date.now()}`,
    propertyAddress: '',
    inspectionDate: new Date().toISOString().slice(0, 10),
    agentName: '',
    agentCompany: '',
    clientName: '',
    tenantName: '',
    reportType: 'Property Condition Report',
    rooms: [],
    agencyId: 'proinspect-agency',
    lifecycleStatus: 'draft',
  };

  const workspace = useReportWorkspace(initialReportData);
  const { report, setReport, updateReport, isDirty, markSaved, activeAreaId, selectArea, updateArea, addArea, removeArea } = workspace;

  const handleUpdateReport = (patch: Partial<ReportData>) => {
    updateReport((prev) => ({ ...prev, ...patch }));
  };

  const analysis = useReportAnalysis(report.agencyId);

  useUnsavedChangesGuard(
    isDirty,
    analysis.analysisState.isAnalyzing || isSaving
  );

  const isImmutable = IMMUTABLE_REPORT_STATUSES.has(report.lifecycleStatus || 'draft');

  // Load properties catalogue
  useEffect(() => {
    const fetchProperties = async () => {
      try {
        const records = await listProperties();
        setProperties(records);
        if (report.propertyId) {
          setSelectedPropertyId(report.propertyId);
        } else if (report.propertyAddress) {
          const match = records.find((p) => p.address && report.propertyAddress.includes(p.address));
          if (match) setSelectedPropertyId(match.id);
        }
      } catch (err) {
        console.warn('Failed to load properties in report builder:', err);
      }
    };
    fetchProperties();
  }, [report.propertyId, report.propertyAddress]);

  // Load Report from DB if editing existing
  useEffect(() => {
    const hydrateRouteReport = async () => {
      if (!reportId || reportId === 'new') return;

      setIsHydrating(true);
      try {
        const loadedReport = await loadReportFromDB(reportId);
        if (loadedReport) {
          setReport(loadedReport);
          markSaved();
          await logAuditEvent({
            agencyId: loadedReport.agencyId || 'proinspect-agency',
            actorId: 'user',
            actorRole: 'inspector',
            entityType: 'report',
            entityId: reportId,
            eventType: 'report_loaded',
            metadata: { source: 'report_edit_route' },
          });
        }
      } catch (error) {
        console.error('Failed to load route report', error);
      } finally {
        setIsHydrating(false);
      }
    };

    hydrateRouteReport();
  }, [reportId]);

  const handleImportProperty = (propertyIdToImport?: string) => {
    const targetId = propertyIdToImport || selectedPropertyId;
    if (!targetId) return;
    const prop = properties.find((p) => p.id === targetId);
    if (!prop) return;

    const seeded = seedReportFromProperty(prop, report);
    setReport(seeded);
    setSelectedPropertyId(targetId);
    setImportMessage(`Successfully pulled property details & seeded ${seeded.rooms.length} room templates for ${prop.address}.`);
    setTimeout(() => setImportMessage(''), 6000);
  };

  const handleSeedDefaultRooms = () => {
    const defaultProperty: PropertyRecord = {
      id: 'default',
      agencyId: report.agencyId || 'proinspect-agency',
      address: report.propertyAddress || 'Standard Property',
      bedrooms: 3,
      bathrooms: 2,
      livingAreas: 1,
      parking: 1,
      clientIds: [],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const rooms = seedRoomsFromProperty(defaultProperty);
    handleUpdateReport({ rooms });
    setImportMessage(`Auto-generated ${rooms.length} default room templates.`);
    setTimeout(() => setImportMessage(''), 6000);
  };

  const handleSaveReport = async () => {
    if (isImmutable) {
      alert(`Report is immutable in status "${report.lifecycleStatus}". Direct edits are locked.`);
      return;
    }

    const sanitizedReport = sanitizeReportData(report);
    const { errors } = validateReport(sanitizedReport);

    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    setIsSaving(true);
    try {
      const savedReport = await saveReportToDB(sanitizedReport);
      setReport(savedReport);
      markSaved();
      await upsertReportIndexFromReport(savedReport);
      await logAuditEvent({
        agencyId: savedReport.agencyId || 'proinspect-agency',
        actorId: 'user',
        actorRole: 'inspector',
        entityType: 'report',
        entityId: savedReport.id,
        eventType: savedReport.createdAt === savedReport.updatedAt ? 'report_created' : 'report_updated',
        metadata: { source: 'report_builder_save' },
      });

      if (!reportId || reportId === 'new') {
        navigate(`/reports/${savedReport.id}/edit`, { replace: true });
      }
    } catch (error) {
      console.error('Save report failed', error);
      alert('Failed to save report. Please check your storage connection.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunFullReportAnalysis = async () => {
    await analysis.analyseFullReport(report, (updatedReport) => {
      setReport(updatedReport);
    });
  };

  if (isHydrating) {
    return (
      <div className="flex h-64 items-center justify-center text-xs font-semibold text-slate-500">
        Hydrating property report workspace...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6 pb-24">
      {/* Property & Inspection Metadata Header Panel */}
      <ReportContextPanel
        report={report}
        properties={properties}
        selectedPropertyId={selectedPropertyId}
        onSelectPropertyId={setSelectedPropertyId}
        onImportProperty={handleImportProperty}
        onSeedDefaultRooms={handleSeedDefaultRooms}
        onUpdateReport={handleUpdateReport}
        importMessage={importMessage}
        disabled={isImmutable}
      />

      {/* Global Bulk AI Analysis Status Panel */}
      <ReportAnalysisPanel
        analysisState={analysis.analysisState}
        onAnalyseFullReport={handleRunFullReportAnalysis}
        disabled={isImmutable}
      />

      {/* Primary Inspection Area Workspace */}
      <InspectionWorkspace
        areas={report.rooms}
        activeAreaId={activeAreaId}
        onSelectArea={selectArea}
        onUpdateArea={updateArea}
        onAddArea={addArea}
        onRemoveArea={removeArea}
        previousReport={report.previousReport}
        previousReportNotes={report.previousReportNotes}
        agencyId={report.agencyId}
        readOnly={isImmutable}
      />

      {/* Report Completeness Summary */}
      <ReportCompletenessPanel report={report} />

      {/* Sticky Bottom Page Action Bar */}
      <ReportActionBar
        onSaveDraft={handleSaveReport}
        onPreview={() => navigate(`/reports/${report.id}/preview`)}
        onBackToList={() => navigate('/reports')}
        isSaving={isSaving}
        isDirty={isDirty}
        readOnly={isImmutable}
      />
    </div>
  );
};

export default ReportBuilder;
