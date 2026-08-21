import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { REPORT_CONTENT_LOCKED_STATUSES } from '@pcr/domain';
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

export const ReportBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { reportId } = useParams<{ reportId: string }>();
  const [searchParams] = useSearchParams();
  const requestedAreaId = searchParams.get('area');
  const requestedComponentId = searchParams.get('component');

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
  const {
    report,
    setReport,
    updateReport,
    isDirty,
    markSaved,
    activeAreaId,
    selectArea,
    updateArea,
    addArea,
    removeArea,
  } = workspace;

  const handleUpdateReport = (patch: Partial<ReportData>) => {
    updateReport((prev) => ({ ...prev, ...patch }));
  };

  const analysis = useReportAnalysis(report.agencyId);
  useUnsavedChangesGuard(isDirty, analysis.analysisState.isAnalyzing || isSaving);
  const isImmutable = REPORT_CONTENT_LOCKED_STATUSES.has(report.lifecycleStatus || 'draft');

  useEffect(() => {
    const fetchProperties = async () => {
      try {
        const records = await listProperties();
        setProperties(records);
        if (report.propertyId) {
          setSelectedPropertyId(report.propertyId);
        } else if (report.propertyAddress) {
          const match = records.find((property) => property.address && report.propertyAddress.includes(property.address));
          if (match) setSelectedPropertyId(match.id);
        }
      } catch (error) {
        console.warn('Failed to load properties in report builder:', error);
      }
    };
    void fetchProperties();
  }, [report.propertyId, report.propertyAddress]);

  useEffect(() => {
    const hydrateRouteReport = async () => {
      if (!reportId || reportId === 'new') return;
      setIsHydrating(true);
      try {
        const loadedReport = await loadReportFromDB(reportId);
        if (loadedReport) {
          setReport(loadedReport);
          markSaved();
          if (requestedAreaId && loadedReport.rooms.some((area) => area.id === requestedAreaId)) selectArea(requestedAreaId);
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
    void hydrateRouteReport();
  }, [reportId, requestedAreaId]);

  useEffect(() => {
    if (isHydrating || !requestedComponentId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`component-${requestedComponentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isHydrating, requestedComponentId, activeAreaId]);

  const handleImportProperty = (propertyIdToImport?: string) => {
    if (report.inspectionJobId) {
      setImportMessage('This operational report is already bound to its server-authoritative Property and layout version.');
      return;
    }
    const targetId = propertyIdToImport || selectedPropertyId;
    if (!targetId) return;
    const property = properties.find((candidate) => candidate.id === targetId);
    if (!property) return;
    const seeded = seedReportFromProperty(property, report);
    setReport(seeded);
    setSelectedPropertyId(targetId);
    setImportMessage(`Successfully pulled property details and seeded ${seeded.rooms.length} areas for ${property.address}.`);
    window.setTimeout(() => setImportMessage(''), 6000);
  };

  const handleSeedDefaultRooms = () => {
    if (report.inspectionJobId) return;
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
    window.setTimeout(() => setImportMessage(''), 6000);
  };

  const handleSaveReport = async () => {
    if (isImmutable) {
      window.alert(`Report is immutable in status "${report.lifecycleStatus}". Corrections must use the superseding-report workflow.`);
      return;
    }

    const sanitizedReport = sanitizeReportData(report);
    const { errors } = validateReport(sanitizedReport);
    if (errors.length > 0) {
      window.alert(errors.join('\n'));
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
        navigate(`/app/admin/reports/${savedReport.id}/edit`, { replace: true });
      }
    } catch (error) {
      console.error('Save report failed', error);
      window.alert('Failed to save report. Cloud-authoritative deployments do not silently create a separate local report. Your current unsaved draft remains in this browser session so you can retry.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunFullReportAnalysis = async () => {
    await analysis.analyseFullReport(report, (updatedReport) => setReport(updatedReport));
  };

  if (isHydrating) {
    return (
      <div className="flex h-64 items-center justify-center text-xs font-semibold text-slate-500">
        Hydrating property report workspace...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-24">
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

      <ReportAnalysisPanel
        analysisState={analysis.analysisState}
        onAnalyseFullReport={handleRunFullReportAnalysis}
        disabled={isImmutable}
      />

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
        inspectionType={report.reportType}
        readOnly={isImmutable}
      />

      <ReportCompletenessPanel report={report} />

      <ReportActionBar
        onSaveDraft={handleSaveReport}
        onPreview={() => navigate(`/app/admin/reports/${report.id}/preview`)}
        onBackToList={() => navigate('/app/admin/reports')}
        isSaving={isSaving}
        isDirty={isDirty}
        readOnly={isImmutable}
      />
    </div>
  );
};

export default ReportBuilder;
