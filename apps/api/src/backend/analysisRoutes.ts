import type { IncomingMessage } from 'node:http';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  isGeminiAvailable,
  generateImageTagsServer,
  discoverRoomItemsServer,
  generateOverallCommentServer,
  generateItemCommentServer,
  generateBatchRoomAnalysisServer,
  type PhotoInput,
  type PreviousReportInput,
} from '../services/geminiAnalysisService.js';

async function readJsonPayload(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 10_000_000) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Analysis payload exceeds 10 MB.');
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Object required');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function getAgencyIdFromHeader(req: IncomingMessage): string {
  return req.headers['x-agency-id']?.toString().trim() || '';
}

function parsePhotosInput(rawPhotos: unknown): PhotoInput[] {
  if (!Array.isArray(rawPhotos)) return [];
  return rawPhotos.map((p, idx) => {
    if (!p || typeof p !== 'object') {
      return { id: `photo-${idx + 1}` };
    }
    const item = p as Record<string, unknown>;
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `photo-${idx + 1}`,
      filename: typeof item.filename === 'string' ? item.filename : typeof item.name === 'string' ? item.name : undefined,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
      base64Data: typeof item.base64Data === 'string' ? item.base64Data : undefined,
      tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : undefined,
    };
  });
}

function parsePreviousReportInput(raw: unknown): PreviousReportInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  return {
    filename: typeof item.filename === 'string' ? item.filename : undefined,
    mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
    base64Data: typeof item.base64Data === 'string' ? item.base64Data : undefined,
    notes: typeof item.notes === 'string' ? item.notes : undefined,
  };
}

export async function routeAnalysisRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string
): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'analysis') {
    return undefined;
  }

  const endpoint = parts[3];

  if (req.method === 'GET' && endpoint === 'status') {
    return {
      status: 200,
      body: {
        status: 'ok',
        data: { available: isGeminiAvailable() },
        meta: { correlationId },
      },
    };
  }

  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Analysis endpoint requires POST.');
  }

  const agencyId = getAgencyIdFromHeader(req);
  if (!agencyId) {
    throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  }

  await authenticateAndAuthorise(
    req,
    dependencies,
    'report.read',
    { agencyId },
    correlationId
  );

  // Fail closed when the model service is unavailable. Analysis must never fabricate
  // clean/intact/working observations merely because a credential or upstream model is absent.
  if (!isGeminiAvailable()) {
    throw new ApiError(
      503,
      'AI_UNAVAILABLE',
      'AI analysis is currently unavailable. Preserve the existing inspection assessment and retry when the service is configured.'
    );
  }

  const body = await readJsonPayload(req);

  if (endpoint === 'photo-tags') {
    const photo = (parsePhotosInput(body.photo ? [body.photo] : body.photos)[0]) || { id: 'photo-1' };
    const tags = await generateImageTagsServer(photo);
    return { status: 200, body: { data: tags, meta: { correlationId } } };
  }

  if (endpoint === 'discover-components') {
    const roomName = typeof body.roomName === 'string' ? body.roomName : 'Room';
    const photos = parsePhotosInput(body.photos);
    const items = await discoverRoomItemsServer(roomName, photos);
    return { status: 200, body: { data: items, meta: { correlationId } } };
  }

  if (endpoint === 'overall-comment') {
    const roomName = typeof body.roomName === 'string' ? body.roomName : 'Room';
    const currentComment = typeof body.currentComment === 'string' ? body.currentComment : '';
    const photos = parsePhotosInput(body.photos);
    const previousReport = parsePreviousReportInput(body.previousReport);
    const comment = await generateOverallCommentServer(roomName, photos, currentComment, previousReport);
    return { status: 200, body: { data: comment, meta: { correlationId } } };
  }

  if (endpoint === 'component') {
    const itemName = typeof body.itemName === 'string' ? body.itemName : typeof body.id === 'string' ? body.id : 'Component';
    const roomName = typeof body.roomName === 'string' ? body.roomName : 'Room';
    const currentComment = typeof body.currentComment === 'string' ? body.currentComment : '';
    const photos = parsePhotosInput(body.photos);
    const previousReport = parsePreviousReportInput(body.previousReport);
    const analysis = await generateItemCommentServer(itemName, roomName, photos, currentComment, previousReport);
    return { status: 200, body: { data: analysis, meta: { correlationId } } };
  }

  if (endpoint === 'batch-room') {
    const roomName = typeof body.roomName === 'string' ? body.roomName : 'Room';
    const currentOverallComment = typeof body.currentOverallComment === 'string' ? body.currentOverallComment : '';
    const photos = parsePhotosInput(body.photos);
    const rawItems = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
    const items = rawItems.map((it) => ({
      id: typeof it.id === 'string' ? it.id : typeof it.name === 'string' ? it.name : 'Component',
      name: typeof it.name === 'string' ? it.name : typeof it.id === 'string' ? it.id : 'Component',
      comment: typeof it.comment === 'string' ? it.comment : undefined,
    }));
    const previousReport = parsePreviousReportInput(body.previousReport);
    const result = await generateBatchRoomAnalysisServer(roomName, photos, items, currentOverallComment, previousReport);
    return { status: 200, body: { data: result, meta: { correlationId } } };
  }

  throw new ApiError(404, 'NOT_FOUND', `Analysis endpoint /api/v1/analysis/${endpoint || ''} not found.`);
}
