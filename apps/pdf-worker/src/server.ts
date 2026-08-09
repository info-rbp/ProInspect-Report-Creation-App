import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadRuntimeConfig } from '@pcr/config';
import {
  PdfWorkerError,
  parsePubSubPdfTask,
  processPdfGenerationTask,
} from './pdfGenerationService.js';

const config = loadRuntimeConfig();

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) {
      throw new PdfWorkerError('PAYLOAD_TOO_LARGE', 'PDF task payload exceeds 1 MB.');
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new PdfWorkerError('INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  });
  res.end(bytes);
}

export async function handlePdfWorkerRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', service: 'pcr-pdf-worker' });
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/tasks/pdf') {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
    return;
  }

  let taskId: string | undefined;
  try {
    const body = await readJson(req);
    const task = parsePubSubPdfTask(body);
    taskId = task.taskId;
    const result = await processPdfGenerationTask(task);
    console.log(JSON.stringify({
      level: config.logLevel,
      message: 'pdf.completed',
      taskId: task.taskId,
      reportId: task.reportId,
      reportVersionId: result.reportVersionId,
      status: result.status,
      pdfObjectPath: result.pdfObjectPath,
    }));
    // Any 2xx acknowledges a Pub/Sub push message.
    sendJson(res, 200, { status: result.status, data: result });
  } catch (error) {
    const workerError = error instanceof PdfWorkerError ? error : undefined;
    const retryable = workerError?.retryable ?? true;
    console.error(JSON.stringify({
      level: 'error',
      message: 'pdf.failed',
      taskId: taskId ?? null,
      errorCode: workerError?.code ?? 'PDF_GENERATION_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable,
    }));

    if (!retryable) {
      // Permanent validation/provenance failures are already recorded on the PDF job.
      // Acknowledge them so Pub/Sub does not retry an impossible task forever.
      sendJson(res, 200, {
        status: 'failed',
        error: {
          code: workerError?.code ?? 'PDF_GENERATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      });
      return;
    }

    sendJson(res, 503, {
      error: {
        code: workerError?.code ?? 'PDF_GENERATION_FAILED',
        message: error instanceof Error ? error.message : 'PDF generation failed.',
        retryable: true,
      },
    });
  }
}

export function startPdfWorkerServer(port = Number(process.env.PORT ?? 8080)) {
  const server = createServer((req, res) => {
    void handlePdfWorkerRequest(req, res);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({
      level: config.logLevel,
      message: 'pdf.worker.started',
      port,
    }));
  });
  return server;
}

if (process.env.NODE_ENV !== 'test') startPdfWorkerServer();
