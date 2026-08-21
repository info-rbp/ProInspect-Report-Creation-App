import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref as storageRef } from 'firebase/storage';
import {
  getAuth,
  onAuthStateChanged as onFirebaseAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { openDB } from 'idb';
import type {
  ComponentConditionCategory,
  ComponentCleanlinessCategory,
  ComponentWorkingStatus,
  ComponentTestStatus,
  ComponentReviewStatus,
  ComponentComparisonStatus,
  ReportPhotoReference,
} from '@pcr/domain';
import type { InspectionItem, Photo, ReportData, Room } from '../types';
import { generateId } from '../utils';
import { apiRequest } from './apiClient';
import { getResolvedFirebaseConfig, isFirebaseConfigured as isFirebaseConfigResolved } from './configService';
import { createSeededItem, isOperationalItem } from './platform/propertySeedingService';

export let db: ReturnType<typeof getFirestore> | undefined;
export let storage: ReturnType<typeof getStorage> | undefined;
export let auth: ReturnType<typeof getAuth> | undefined;

try {
  const firebaseConfig = getResolvedFirebaseConfig();
  if (firebaseConfig) {
    const app = initializeApp(firebaseConfig);
    db = firebaseConfig.firestoreDatabaseId
      ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
      : getFirestore(app);
    storage = getStorage(app);
    auth = getAuth(app);
  }
} catch (error) {
  console.error('Firebase initialization failed', error);
}

export const isFirebaseConfigured = isFirebaseConfigResolved;
export const getFirestoreDb = () => db;
export const getFirebaseAuth = () => auth;
export const onAuthStateChanged = onFirebaseAuthStateChanged;

export const signInWithEmailPassword = async (email: string, password: string): Promise<User> => {
  if (!auth) throw new Error('Identity Platform is not configured for this deployment.');
  return (await signInWithEmailAndPassword(auth, email, password)).user;
};

export const signOutUser = async (): Promise<void> => {
  if (auth) await signOut(auth);
};

const LOCAL_DB_NAME = 'rbp-reports-db';
const LOCAL_STORE_NAME = 'reports';
const resolvedPhotoUrls = new Map<string, Promise<string>>();

interface AggregateComponent {
  id: string;
  component: string;
  subComponent?: string;
  material?: string;
  colour?: string;
  type?: string;
  quantity?: number;
  conditionCategory: ComponentConditionCategory;
  cleanlinessCategory: ComponentCleanlinessCategory;
  workingStatus: ComponentWorkingStatus;
  testStatus: ComponentTestStatus;
  testRecord?: InspectionItem['testRecord'];
  defects: string[];
  maintenanceRequired: boolean;
  commentary: string;
  photoReferences: ReportPhotoReference[];
  aiConfidence?: number;
  aiSuggestion?: InspectionItem['aiSuggestion'];
  authoritativeSource?: InspectionItem['authoritativeSource'];
  lastReviewedBy?: string;
  lastReviewedAt?: string;
  reviewStatus: ComponentReviewStatus;
  comparisonStatus: ComponentComparisonStatus;
  presenceComparison?: InspectionItem['presenceComparison'];
  conditionComparison?: InspectionItem['conditionComparison'];
  cleanlinessComparison?: InspectionItem['cleanlinessComparison'];
  workingComparison?: InspectionItem['workingComparison'];
  comparisonCommentary?: string;
  baselineComponentId?: string;
  baselineComponentData?: InspectionItem['baselineComponentData'];
  baselineEvidencePhotoIds?: string[];
  currentEvidencePhotoIds?: string[];
  evidencePairs?: InspectionItem['evidencePairs'];
  comparisonConfidence?: number;
  comparisonUncertainty?: string;
  comparisonReviewStatus?: InspectionItem['comparisonReviewStatus'];
  comparisonMethod?: InspectionItem['comparisonMethod'];
  tenantResponseId?: string;
}

interface AggregateArea {
  id: string;
  name: string;
  sequence: number;
  overallCommentary?: string;
  photoReferences?: ReportPhotoReference[];
  components: AggregateComponent[];
}

interface ReportAggregatePayload {
  report: Record<string, unknown> & {
    id: string;
    agencyId: string;
    lifecycleStatus: string;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
  };
  areas: AggregateArea[];
  expectedVersion?: number;
}

const initLocalDB = async () => openDB(LOCAL_DB_NAME, 1, {
  upgrade(database) {
    if (!database.objectStoreNames.contains(LOCAL_STORE_NAME)) {
      database.createObjectStore(LOCAL_STORE_NAME, { keyPath: 'id' });
    }
  },
});

export function normalizeItem(rawItem: any): InspectionItem {
  if (!rawItem) return createSeededItem('Component');

  if (rawItem.conditionCategory && rawItem.cleanlinessCategory) {
    const operational = isOperationalItem(rawItem.name || rawItem.component || '');
    return {
      id: rawItem.id || generateId(),
      name: rawItem.name || rawItem.component || 'Component',
      subComponent: rawItem.subComponent,
      material: rawItem.material,
      colour: rawItem.colour,
      type: rawItem.type,
      quantity: rawItem.quantity,
      conditionCategory: rawItem.conditionCategory,
      cleanlinessCategory: rawItem.cleanlinessCategory,
      workingStatus: rawItem.workingStatus || (operational ? 'untested' : 'not_applicable'),
      testStatus: rawItem.testStatus || (operational ? 'untested' : 'not_applicable'),
      testRecord: rawItem.testRecord,
      defects: Array.isArray(rawItem.defects) ? rawItem.defects : [],
      maintenanceRequired: Boolean(rawItem.maintenanceRequired),
      comment: rawItem.comment ?? rawItem.commentary ?? '',
      photoReferences: Array.isArray(rawItem.photoReferences) ? rawItem.photoReferences : [],
      aiConfidence: rawItem.aiConfidence,
      aiSuggestion: rawItem.aiSuggestion,
      authoritativeSource: rawItem.authoritativeSource,
      lastReviewedBy: rawItem.lastReviewedBy,
      lastReviewedAt: rawItem.lastReviewedAt,
      reviewStatus: rawItem.reviewStatus || 'draft',
      comparisonStatus: rawItem.comparisonStatus || 'not_compared',
      presenceComparison: rawItem.presenceComparison,
      conditionComparison: rawItem.conditionComparison,
      cleanlinessComparison: rawItem.cleanlinessComparison,
      workingComparison: rawItem.workingComparison,
      comparisonCommentary: rawItem.comparisonCommentary,
      baselineComponentId: rawItem.baselineComponentId,
      baselineComponentData: rawItem.baselineComponentData,
      baselineEvidencePhotoIds: rawItem.baselineEvidencePhotoIds,
      currentEvidencePhotoIds: rawItem.currentEvidencePhotoIds,
      evidencePairs: rawItem.evidencePairs,
      comparisonConfidence: rawItem.comparisonConfidence,
      comparisonUncertainty: rawItem.comparisonUncertainty,
      comparisonReviewStatus: rawItem.comparisonReviewStatus,
      comparisonMethod: rawItem.comparisonMethod,
      tenantResponseId: rawItem.tenantResponseId,
    };
  }

  const operational = isOperationalItem(rawItem.name || rawItem.component || '');
  const isUndamaged = rawItem.isUndamaged !== false;
  const isClean = rawItem.isClean !== false;

  let workingStatus: ComponentWorkingStatus = operational ? 'untested' : 'not_applicable';
  let testStatus: ComponentTestStatus = operational ? 'untested' : 'not_applicable';

  if (rawItem.isWorking === false && operational) {
    workingStatus = 'not_working';
    testStatus = rawItem.testStatus === 'tested_failed' ? 'tested_failed' : 'unable_to_confirm';
  } else if (rawItem.workingStatus) {
    workingStatus = rawItem.workingStatus;
    testStatus = rawItem.testStatus || 'untested';
  }

  const commentText = rawItem.comment ?? rawItem.commentary ?? '';

  return {
    id: rawItem.id || generateId(),
    name: rawItem.name || rawItem.component || 'Component',
    conditionCategory: isUndamaged ? 'intact' : 'repair_required',
    cleanlinessCategory: isClean ? 'clean' : 'requires_cleaning',
    workingStatus,
    testStatus,
    defects: !isUndamaged && commentText
      ? [commentText]
      : (Array.isArray(rawItem.defects) ? rawItem.defects : []),
    maintenanceRequired: Boolean(rawItem.maintenanceRequired || !isUndamaged || workingStatus === 'not_working'),
    comment: commentText,
    photoReferences: Array.isArray(rawItem.photoReferences) ? rawItem.photoReferences : [],
    reviewStatus: 'draft',
    comparisonStatus: 'not_compared',
  };
}

function photoReference(photo: Photo): ReportPhotoReference | undefined {
  const objectPath = photo.objectPath ?? photo.downloadUrl;
  return objectPath
    ? {
        photoId: photo.id,
        objectPath,
        ...(photo.thumbnailObjectPath ? { thumbnailObjectPath: photo.thumbnailObjectPath } : {}),
      }
    : undefined;
}

function toAggregate(report: ReportData): ReportAggregatePayload {
  if (!report.agencyId) throw new Error('agencyId is required before saving a cloud report.');
  const metadata: ReportAggregatePayload['report'] = {
    id: report.id,
    agencyId: report.agencyId,
    propertyId: report.propertyId,
    tenancyId: report.tenancyId,
    inspectionJobId: report.inspectionJobId,
    propertyLayoutVersionId: report.propertyLayoutVersionId,
    lifecycleStatus: report.lifecycleStatus ?? 'draft',
    reportType: report.reportType,
    templateId: report.templateId,
    templateVersion: report.templateVersion,
    propertyAddress: report.propertyAddress,
    clientName: report.clientName,
    tenantName: report.tenantName,
    inspectionDate: report.inspectionDate,
    agentName: report.agentName,
    agentCompany: report.agentCompany,
    agentAddress: report.agentAddress,
    agentPhone: report.agentPhone,
    agentEmail: report.agentEmail,
    previousReportNotes: report.previousReportNotes,
    currentVersionId: report.currentVersionId,
    issuedAt: report.issuedAt,
    tenantReviewDueAt: report.tenantReviewDueAt,
    finalisedAt: report.finalisedAt,
    archivedAt: report.archivedAt,
    finalPdfReportVersionId: report.finalPdfReportVersionId,
    finalPdfObjectPath: report.finalPdfObjectPath,
    finalPdfSha256: report.finalPdfSha256,
    finalPdfGeneration: report.finalPdfGeneration,
    renderManifestObjectPath: report.renderManifestObjectPath,
    renderManifestSha256: report.renderManifestSha256,
    pdfGeneratedAt: report.pdfGeneratedAt,
    archiveReportVersionId: report.archiveReportVersionId,
    archiveManifestObjectPath: report.archiveManifestObjectPath,
    archiveManifestSha256: report.archiveManifestSha256,
    archiveCreatedAt: report.archiveCreatedAt,
    baselineReportId: report.baselineReportId,
    baselineReportVersionId: report.baselineReportVersionId,
    baselineInspectionJobId: report.baselineInspectionJobId,
    baselineTemplateId: report.baselineTemplateId,
    baselineTemplateVersion: report.baselineTemplateVersion,
    baselineQuality: report.baselineQuality,
    ownerUid: report.ownerUid,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    version: report.version,
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) delete metadata[key];
  }

  return {
    report: metadata,
    areas: (report.rooms || []).map((room, areaIndex) => {
      const references = (room.photos || [])
        .map(photoReference)
        .filter((value): value is ReportPhotoReference => Boolean(value));
      return {
        id: room.id,
        name: room.name,
        sequence: areaIndex + 1,
        ...(room.overallComment ? { overallCommentary: room.overallComment } : {}),
        ...(references.length > 0 ? { photoReferences: references } : {}),
        components: (room.items || []).map((item) => {
          const norm = normalizeItem(item);
          return {
            id: norm.id,
            component: norm.name,
            subComponent: norm.subComponent,
            material: norm.material,
            colour: norm.colour,
            type: norm.type,
            quantity: norm.quantity,
            conditionCategory: norm.conditionCategory,
            cleanlinessCategory: norm.cleanlinessCategory,
            workingStatus: norm.workingStatus,
            testStatus: norm.testStatus,
            testRecord: norm.testRecord,
            defects: norm.defects || [],
            maintenanceRequired: norm.maintenanceRequired || false,
            commentary: norm.comment || '',
            photoReferences: norm.photoReferences || [],
            aiConfidence: norm.aiConfidence,
            aiSuggestion: norm.aiSuggestion,
            authoritativeSource: norm.authoritativeSource,
            lastReviewedBy: norm.lastReviewedBy,
            lastReviewedAt: norm.lastReviewedAt,
            reviewStatus: norm.reviewStatus || 'draft',
            comparisonStatus: norm.comparisonStatus || 'not_compared',
            presenceComparison: norm.presenceComparison,
            conditionComparison: norm.conditionComparison,
            cleanlinessComparison: norm.cleanlinessComparison,
            workingComparison: norm.workingComparison,
            comparisonCommentary: norm.comparisonCommentary,
            baselineComponentId: norm.baselineComponentId,
            baselineComponentData: norm.baselineComponentData,
            baselineEvidencePhotoIds: norm.baselineEvidencePhotoIds,
            currentEvidencePhotoIds: norm.currentEvidencePhotoIds,
            evidencePairs: norm.evidencePairs,
            comparisonConfidence: norm.comparisonConfidence,
            comparisonUncertainty: norm.comparisonUncertainty,
            comparisonReviewStatus: norm.comparisonReviewStatus,
            comparisonMethod: norm.comparisonMethod,
            tenantResponseId: norm.tenantResponseId,
          };
        }).map((component) => {
          const cleaned = { ...component } as Record<string, unknown>;
          for (const [key, value] of Object.entries(cleaned)) if (value === undefined) delete cleaned[key];
          return cleaned as unknown as AggregateComponent;
        }),
      };
    }),
    ...(report.version ? { expectedVersion: report.version } : {}),
  };
}

async function resolvedPhoto(reference: ReportPhotoReference): Promise<Photo> {
  const objectPath = reference.thumbnailObjectPath ?? reference.objectPath;
  let urlPromise = resolvedPhotoUrls.get(objectPath);
  if (!urlPromise) {
    urlPromise = storage
      ? getDownloadURL(storageRef(storage, objectPath)).catch(() => reference.objectPath)
      : Promise.resolve(reference.objectPath);
    resolvedPhotoUrls.set(objectPath, urlPromise);
  }
  const previewUrl = await urlPromise;
  const name = reference.objectPath.split('/').at(-1) ?? reference.photoId;
  return {
    id: reference.photoId,
    file: new File([], name),
    previewUrl,
    downloadUrl: previewUrl,
    objectPath: reference.objectPath,
    ...(reference.thumbnailObjectPath ? { thumbnailObjectPath: reference.thumbnailObjectPath } : {}),
  };
}

function reportMetadata(metadata: ReportAggregatePayload['report'], rooms: Room[] = []): ReportData {
  return {
    id: metadata.id,
    agencyId: metadata.agencyId,
    propertyId: metadata.propertyId as string | undefined,
    tenancyId: metadata.tenancyId as string | undefined,
    inspectionJobId: metadata.inspectionJobId as string | undefined,
    propertyLayoutVersionId: metadata.propertyLayoutVersionId as string | undefined,
    lifecycleStatus: metadata.lifecycleStatus as ReportData['lifecycleStatus'],
    currentVersionId: metadata.currentVersionId as string | undefined,
    templateId: metadata.templateId as string | undefined,
    templateVersion: metadata.templateVersion as number | undefined,
    issuedAt: metadata.issuedAt as string | undefined,
    tenantReviewDueAt: metadata.tenantReviewDueAt as string | undefined,
    finalisedAt: metadata.finalisedAt as string | undefined,
    archivedAt: metadata.archivedAt as string | undefined,
    finalPdfReportVersionId: metadata.finalPdfReportVersionId as string | undefined,
    finalPdfObjectPath: metadata.finalPdfObjectPath as string | undefined,
    finalPdfSha256: metadata.finalPdfSha256 as string | undefined,
    finalPdfGeneration: metadata.finalPdfGeneration as string | undefined,
    renderManifestObjectPath: metadata.renderManifestObjectPath as string | undefined,
    renderManifestSha256: metadata.renderManifestSha256 as string | undefined,
    pdfGeneratedAt: metadata.pdfGeneratedAt as string | undefined,
    archiveReportVersionId: metadata.archiveReportVersionId as string | undefined,
    archiveManifestObjectPath: metadata.archiveManifestObjectPath as string | undefined,
    archiveManifestSha256: metadata.archiveManifestSha256 as string | undefined,
    archiveCreatedAt: metadata.archiveCreatedAt as string | undefined,
    propertyAddress: String(metadata.propertyAddress ?? ''),
    agentName: String(metadata.agentName ?? ''),
    agentCompany: String(metadata.agentCompany ?? ''),
    agentAddress: metadata.agentAddress as string | undefined,
    agentPhone: metadata.agentPhone as string | undefined,
    agentEmail: metadata.agentEmail as string | undefined,
    clientName: String(metadata.clientName ?? ''),
    inspectionDate: String(metadata.inspectionDate ?? ''),
    tenantName: String(metadata.tenantName ?? ''),
    reportType: String(metadata.reportType ?? ''),
    baselineReportId: metadata.baselineReportId as string | undefined,
    baselineReportVersionId: metadata.baselineReportVersionId as string | undefined,
    baselineInspectionJobId: metadata.baselineInspectionJobId as string | undefined,
    baselineTemplateId: metadata.baselineTemplateId as string | undefined,
    baselineTemplateVersion: metadata.baselineTemplateVersion as number | undefined,
    baselineQuality: metadata.baselineQuality as ReportData['baselineQuality'],
    previousReportNotes: metadata.previousReportNotes as string | undefined,
    rooms,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ownerUid: metadata.ownerUid as string | undefined,
    version: metadata.version,
  };
}

async function fromAggregate(aggregate: ReportAggregatePayload): Promise<ReportData> {
  const rooms = await Promise.all(aggregate.areas.map(async (area): Promise<Room> => {
    const references = new Map<string, ReportPhotoReference>();
    for (const reference of area.photoReferences || []) references.set(reference.photoId, reference);
    for (const component of area.components) {
      for (const reference of component.photoReferences || []) {
        if (!references.has(reference.photoId)) references.set(reference.photoId, reference);
      }
    }

    const photos = await Promise.all([...references.values()].map(resolvedPhoto));
    return {
      id: area.id,
      name: area.name,
      status: area.components.every((component) => component.reviewStatus === 'reviewer_approved')
        ? 'complete'
        : 'draft',
      items: area.components.map((component) => normalizeItem({
        ...component,
        id: component.id,
        name: component.component,
        commentary: component.commentary,
      })),
      photos,
      overallComment: area.overallCommentary ?? '',
    };
  }));
  return reportMetadata(aggregate.report, rooms);
}

function cloudMode(): boolean {
  return Boolean(isFirebaseConfigured() && auth && import.meta.env.VITE_API_BASE_URL?.trim());
}

export const saveReportToDB = async (report: ReportData): Promise<ReportData> => {
  const timestamp = new Date().toISOString();
  const prepared = { ...report, createdAt: report.createdAt || timestamp, updatedAt: timestamp };
  if (!cloudMode()) {
    const localDB = await initLocalDB();
    await localDB.put(LOCAL_STORE_NAME, prepared);
    return prepared;
  }

  const stored = await apiRequest<ReportAggregatePayload>(
    report.agencyId,
    `/api/v1/reports/${report.id}/aggregate`,
    { method: 'PUT', body: toAggregate(prepared) },
  );
  return fromAggregate(stored);
};

const normalizeReport = (report: ReportData | undefined): ReportData | undefined => {
  if (!report) return undefined;
  const roomsRaw = report.rooms || (report as any).areas || [];
  const normalizedRooms: Room[] = roomsRaw.map((room: any) => ({
    ...room,
    id: room.id || generateId(),
    name: room.name || 'Room',
    status: room.status || 'draft',
    overallComment: room.overallComment ?? room.overallCommentary ?? '',
    photos: room.photos || [],
    items: (room.items || room.components || []).map(normalizeItem),
  }));

  return {
    ...report,
    rooms: normalizedRooms,
    agentName: report.agentName || (report as any).inspectorName || 'Admin Team',
    agentCompany: report.agentCompany || 'ProInspect',
    clientName: report.clientName || (report as any).landlordName || '',
    tenantName: report.tenantName || '',
    propertyAddress: report.propertyAddress || '',
    reportType: report.reportType || 'Property Condition Report',
  };
};

export const loadReportFromDB = async (id: string): Promise<ReportData | undefined> => {
  if (!cloudMode()) {
    const localReport = await (await initLocalDB()).get(LOCAL_STORE_NAME, id);
    return normalizeReport(localReport);
  }

  try {
    const report = await fromAggregate(
      await apiRequest<ReportAggregatePayload>(undefined, `/api/v1/reports/${id}/aggregate`),
    );
    return normalizeReport(report);
  } catch (error) {
    if ((error as { code?: string }).code === 'NOT_FOUND') return undefined;
    throw error;
  }
};

export const getAllSavedReports = async (): Promise<ReportData[]> => {
  let reports: ReportData[];
  if (!cloudMode()) {
    reports = await (await initLocalDB()).getAll(LOCAL_STORE_NAME);
  } else {
    const aggregateReports = await apiRequest<Array<ReportAggregatePayload['report']>>(
      undefined,
      '/api/v1/reports',
    );
    reports = aggregateReports.map((metadata) => reportMetadata(metadata));
  }
  return reports.map((report) => normalizeReport(report)!).filter(Boolean);
};

export const deleteReportFromDB = async (id: string): Promise<void> => {
  if (!cloudMode()) {
    await (await initLocalDB()).delete(LOCAL_STORE_NAME, id);
    return;
  }

  const existing = await apiRequest<ReportAggregatePayload>(undefined, `/api/v1/reports/${id}/aggregate`);
  await apiRequest<Record<string, unknown>>(
    String(existing.report.agencyId),
    `/api/v1/report-actions/${encodeURIComponent(id)}/lifecycle/transition`,
    {
      method: 'POST',
      body: {
        status: 'cancelled',
        expectedVersion: existing.report.version ?? 1,
        reason: 'draft_deleted_by_operator',
      },
    },
  );
};
