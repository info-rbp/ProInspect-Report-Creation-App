import { API_ROUTE_NAMES, ROUTE_POLICIES } from './routeCatalog.js';

function operation(resource: string, method: 'get' | 'post' | 'patch' | 'put', collection: boolean) {
  const policy = ROUTE_POLICIES[resource];
  if (!policy) throw new Error(`Missing route policy for ${resource}.`);
  return {
    operationId: `${method}${resource.replace(/-([a-z])/gu, (_match: string, letter: string) => letter.toUpperCase())}${collection ? 'Collection' : 'Record'}`,
    tags: [resource],
    security: [{ bearerAuth: [], appCheck: [], agency: [] }],
    parameters: [
      { name: 'x-agency-id', in: 'header', required: true, schema: { type: 'string' } },
      ...(!collection ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] : []),
      ...(method !== 'get' ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 } }] : []),
    ],
    ...(method !== 'get' ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } } : {}),
    responses: {
      [method === 'post' ? '201' : '200']: { description: 'Successful response' },
      '400': { $ref: '#/components/responses/Error' },
      '401': { $ref: '#/components/responses/Error' },
      '403': { $ref: '#/components/responses/Error' },
      '409': { $ref: '#/components/responses/Error' },
      '413': { $ref: '#/components/responses/Error' },
      '429': { $ref: '#/components/responses/Error' },
    },
    'x-required-capability': method === 'get' ? policy.readCapability : policy.writeCapability,
  };
}

export function buildOpenApiDocument() {
  const paths: Record<string, unknown> = {};
  for (const resource of API_ROUTE_NAMES) {
    const policy = ROUTE_POLICIES[resource];
    if (!policy) continue;
    paths[`/api/v1/${resource}`] = {
      get: operation(resource, 'get', true),
      ...(policy.writeCapability ? { post: operation(resource, 'post', true) } : {}),
    };
    paths[`/api/v1/${resource}/{id}`] = {
      get: operation(resource, 'get', false),
      ...(policy.writeCapability ? { patch: operation(resource, 'patch', false) } : {}),
    };
  }

  paths['/api/v1/inspection-jobs/{id}/transitions'] = {
    post: {
      ...operation('inspection-jobs', 'post', false),
      operationId: 'transitionInspectionJob',
      responses: { '200': { description: 'Workflow transition completed' }, '409': { $ref: '#/components/responses/Error' } },
    },
  };
  paths['/api/v1/reports/{id}/aggregate'] = {
    get: {
      ...operation('reports', 'get', false),
      operationId: 'getReportAggregate',
      responses: { '200': { description: 'Decomposed report metadata, areas and components' }, '404': { $ref: '#/components/responses/Error' } },
    },
    put: {
      ...operation('reports', 'put', false),
      operationId: 'saveReportAggregate',
      description: 'Atomically creates or replaces editable report metadata, areas and components. Binary media is rejected.',
      responses: {
        '200': { description: 'Existing aggregate updated' },
        '201': { description: 'Aggregate created' },
        '400': { $ref: '#/components/responses/Error' },
        '409': { $ref: '#/components/responses/Error' },
        '413': { $ref: '#/components/responses/Error' },
      },
    },
  };
  paths['/api/v1/reports/{id}/transitions'] = {
    post: {
      ...operation('reports', 'post', false),
      operationId: 'transitionReport',
      description: 'Atomically changes report and job state, assignment, audit, notification and immutable version records.',
      responses: { '200': { description: 'Report transition completed' }, '409': { $ref: '#/components/responses/Error' } },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Property Condition Report API',
      version: '1.1.0',
      description: 'Server-authoritative Cloud Run API for agency-scoped property inspection operations.',
    },
    servers: [{ url: '/', description: 'Current Cloud Run service' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID token' },
        appCheck: { type: 'apiKey', in: 'header', name: 'X-Firebase-AppCheck' },
        agency: { type: 'apiKey', in: 'header', name: 'X-Agency-Id' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'status', 'correlationId'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                status: { type: 'integer' },
                correlationId: { type: 'string' },
                details: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      responses: {
        Error: { description: 'Consistent API error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}
