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
import type { Photo, ReportData, Room } from '../types';
import { apiRequest } from './apiClient';
import { getResolvedFirebaseConfig, isFirebaseConfigured as isFirebaseConfigResolved } from './configService';

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
  conditionCategory: string;
  cleanlinessCategory: string;
  workingStatus: string;
  testStatus: string;
  defects: string[];
  maintenanceRequired: boolean;
  commentary: string;
  photoReferences: Array<{ photoId: string; objectPath: string; thumbnailObjectPath?: string }>;
  reviewStatus: string;
  comparisonStatus: string;
}

interface AggregateArea {
  id: string;
  name: string;
  sequence: number;
  overallCommentary?: string;
  components: AggregateComponent[];
}

interface ReportAggregatePayload {
  report: Record<string, unknown> & { id: string; agencyId: string; lifecycleStatus: string; version?: number; createdAt?: string; updatedAt?: string };
  areas: AggregateArea[];
  expectedVersion?: number;
}

const initLocalDB = async () => openDB(LOCAL_DB_NAME, 1, {
  upgrade(database) {
    if (!database.objectStoreNames.contains(LOCAL_STORE_NAME)) database.createObjectStore(LOCAL_STORE_NAME, { keyPath: 'id' });
  },
});

function photoReference(photo: Photo) {
  const objectPath = photo.objectPath ?? photo.downloadUrl;
  return objectPath ? {
    photoId: photo.id,
    objectPath,
    ...(photo.thumbnailObjectPath ? { thumbnailObjectPath: photo.thumbnailObjectPath } : {}),
  } : undefined;
}

function toAggregate(report: ReportData): ReportAggregatePayload {
  if (!report.agencyId) throw new Error('agencyId is required before saving a cloud report.');
  const metadata: ReportAggregatePayload['report'] = {
    id: report.id,
    agencyId: report.agencyId,
    propertyId: report.propertyId,
    tenancyId: report.tenancyId,
    inspectionJobId: report.inspectionJobId,
    lifecycleStatus: report.lifecycleStatus ?? 'draft',
    reportType: report.reportType,
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
    ownerUid: report.ownerUid,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    version: report.version,
  };
  for (const [key, value] of Object.entries(metadata)) if (value === undefined) delete metadata[key];

  return {
    report: metadata,
    areas: (report.rooms || []).map((room, areaIndex) => {
      const references = (room.photos || []).map(photoReference).filter((value): value is NonNullable<typeof value> => Boolean(value));
      return {
        id: room.id,
        name: room.name,
        sequence: areaIndex + 1,
        ...(room.overallComment ? { overallCommentary: room.overallComment } : {}),
        components: (room.items || []).map((item) => ({
          id: item.id,
          component: item.name,
          conditionCategory: item.isUndamaged ? 'intact' : 'repair_required',
          cleanlinessCategory: item.isClean ? 'clean' : 'requires_cleaning',
          workingStatus: item.isWorking ? 'operation_confirmed' : 'not_working',
          testStatus: item.isWorking ? 'tested_passed' : 'tested_failed',
          defects: item.isUndamaged ? [] : [item.comment || 'Condition issue recorded.'],
          maintenanceRequired: !item.isUndamaged || !item.isWorking,
          commentary: item.comment || `${item.name} assessed during inspection.`,
          photoReferences: references,
          reviewStatus: room.status === 'complete' ? 'reviewer_approved' : room.status === 'analyzed' ? 'ai_generated' : 'draft',
          comparisonStatus: 'not_compared',
        })),
      };
    }),
    ...(report.version ? { expectedVersion: report.version } : {}),
  };
}

async function resolvedPhoto(reference: AggregateComponent['photoReferences'][number]): Promise<Photo> {
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
    lifecycleStatus: metadata.lifecycleStatus as ReportData['lifecycleStatus'],
    currentVersionId: metadata.currentVersionId as string | undefined,
    issuedAt: metadata.issuedAt as string | undefined,
    tenantReviewDueAt: metadata.tenantReviewDueAt as string | undefined,
    finalisedAt: metadata.finalisedAt as string | undefined,
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
    const references = new Map<string, AggregateComponent['photoReferences'][number]>();
    for (const component of area.components) for (const reference of component.photoReferences) references.set(reference.photoId, reference);
    const photos = await Promise.all([...references.values()].map(resolvedPhoto));
    return {
      id: area.id,
      name: area.name,
      status: area.components.every((component) => component.reviewStatus === 'reviewer_approved') ? 'complete' : 'draft',
      items: area.components.map((component) => ({
        id: component.id,
        name: component.component,
        isClean: component.cleanlinessCategory === 'clean',
        isUndamaged: !['repair_required', 'replacement_recommended'].includes(component.conditionCategory),
        isWorking: component.workingStatus === 'operation_confirmed',
        comment: component.commentary,
      })),
      photos,
      overallComment: area.overallCommentary ?? '',
    };
  }));
  return reportMetadata(aggregate.report, rooms);
}

export const saveReportToDB = async (report: ReportData): Promise<ReportData> => {
  const timestamp = new Date().toISOString();
  const prepared = { ...report, createdAt: report.createdAt || timestamp, updatedAt: timestamp };
  if (!isFirebaseConfigured() || !auth || !import.meta.env.VITE_API_BASE_URL?.trim()) {
    const localDB = await initLocalDB();
    await localDB.put(LOCAL_STORE_NAME, prepared);
    return prepared;
  }
  try {
    const stored = await apiRequest<ReportAggregatePayload>(report.agencyId, `/api/v1/reports/${report.id}/aggregate`, {
      method: 'PUT',
      body: toAggregate(prepared),
    });
    return fromAggregate(stored);
  } catch (err) {
    console.warn('Cloud API save failed, saving to local IndexedDB:', err);
    const localDB = await initLocalDB();
    await localDB.put(LOCAL_STORE_NAME, prepared);
    return prepared;
  }
};

const normalizeReport = (report: ReportData | undefined): ReportData | undefined => {
  if (!report) return undefined;
  return {
    ...report,
    rooms: report.rooms || (report as any).areas || [],
    agentName: report.agentName || (report as any).inspectorName || 'Admin Team',
    agentCompany: report.agentCompany || 'ProInspect',
    clientName: report.clientName || (report as any).landlordName || '',
    tenantName: report.tenantName || '',
    propertyAddress: report.propertyAddress || '',
    reportType: report.reportType || 'Property Condition Report',
  };
};

export const loadReportFromDB = async (id: string): Promise<ReportData | undefined> => {
  if (!isFirebaseConfigured() || !auth || !import.meta.env.VITE_API_BASE_URL?.trim()) {
    const localReport = await (await initLocalDB()).get(LOCAL_STORE_NAME, id);
    return normalizeReport(localReport);
  }
  try {
    const report = await fromAggregate(await apiRequest<ReportAggregatePayload>(undefined, `/api/v1/reports/${id}/aggregate`));
    return normalizeReport(report);
  } catch (error) {
    if ((error as { code?: string }).code === 'NOT_FOUND') return undefined;
    console.warn('Cloud API load failed, loading from local IndexedDB:', error);
    const localReport = await (await initLocalDB()).get(LOCAL_STORE_NAME, id);
    return normalizeReport(localReport);
  }
};

export const getAllSavedReports = async (): Promise<ReportData[]> => {
  let reports: ReportData[] = [];
  if (!isFirebaseConfigured() || !auth || !import.meta.env.VITE_API_BASE_URL?.trim()) {
    reports = await (await initLocalDB()).getAll(LOCAL_STORE_NAME);
  } else {
    try {
      const aggregateReports = await apiRequest<Array<ReportAggregatePayload['report']>>(undefined, '/api/v1/reports');
      reports = aggregateReports.map((metadata) => reportMetadata(metadata));
    } catch (err) {
      console.warn('Cloud API getAllSavedReports failed, fetching from local IndexedDB:', err);
      reports = await (await initLocalDB()).getAll(LOCAL_STORE_NAME);
    }
  }
  return reports.map((r) => normalizeReport(r)!).filter(Boolean);
};

export const deleteReportFromDB = async (id: string): Promise<void> => {
  if (!isFirebaseConfigured() || !auth || !import.meta.env.VITE_API_BASE_URL?.trim()) {
    await (await initLocalDB()).delete(LOCAL_STORE_NAME, id);
    return;
  }
  try {
    const existing = await apiRequest<ReportAggregatePayload>(undefined, `/api/v1/reports/${id}/aggregate`);
    await apiRequest<Record<string, unknown>>(String(existing.report.agencyId), `/api/v1/reports/${id}/transitions`, {
      method: 'POST',
      body: { status: 'cancelled', expectedVersion: existing.report.version ?? 1, reason: 'draft_deleted_by_operator' },
    });
  } catch (err) {
    console.warn('Cloud API delete failed, deleting from local IndexedDB:', err);
    await (await initLocalDB()).delete(LOCAL_STORE_NAME, id);
  }
};
