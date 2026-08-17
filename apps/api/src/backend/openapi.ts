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
    ...(method !== 'get'
      ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } }
      : {}),
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

function commandOperation(resource: 'maintenance-items' | 'work-requests' | 'tenant-instructions', operationId: string, description: string) {
  const policy = ROUTE_POLICIES[resource];
  return {
    operationId,
    tags: [resource],
    description,
    security: [{ bearerAuth: [], appCheck: [], agency: [] }],
    parameters: [
      { name: 'x-agency-id', in: 'header', required: true, schema: { type: 'string' } },
      { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 } },
    ],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
    responses: {
      '200': { description: 'Idempotent command replayed or completed' },
      '201': { description: 'Resource created' },
      '400': { $ref: '#/components/responses/Error' },
      '403': { $ref: '#/components/responses/Error' },
      '409': { $ref: '#/components/responses/Error' },
    },
    'x-required-capability': policy?.readCapability,
  };
}

function templateParameters(includeVersion = false, includeAction = false) {
  return [
    { name: 'x-agency-id', in: 'header', required: true, schema: { type: 'string' } },
    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ...(includeVersion ? [{ name: 'version', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }] : []),
    ...(includeAction ? [{ name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['publish', 'duplicate', 'retire'] } }] : []),
  ];
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

  for (const resource of ['maintenance-items', 'work-requests', 'tenant-instructions'] as const) {
    paths[`/api/v1/${resource}/create`] = {
      post: commandOperation(resource, `create${resource.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase())}`, `Creates a ${resource} record in its safe initial lifecycle state. Caller-supplied lifecycle status is ignored.`),
    };
    paths[`/api/v1/${resource}/{id}/actions/{action}`] = {
      post: {
        ...commandOperation(resource, `transition${resource.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase())}`, 'Executes a versioned, idempotent lifecycle business command.'),
        parameters: [
          { name: 'x-agency-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
    };
  }

  paths['/api/v1/templates/drafts'] = {
    post: {
      operationId: 'createTemplateDraft',
      tags: ['templates'],
      description: 'Creates a new editable template business version in draft state. Published and retired states cannot be supplied.',
      security: [{ bearerAuth: [], appCheck: [], agency: [] }],
      parameters: [
        { name: 'x-agency-id', in: 'header', required: true, schema: { type: 'string' } },
        { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 } },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['template'], properties: { template: { type: 'object', additionalProperties: true } } } } } },
      responses: { '201': { description: 'Draft version created' }, '400': { $ref: '#/components/responses/Error' }, '409': { $ref: '#/components/responses/Error' } },
      'x-required-capability': 'template.manage',
    },
  };
  paths['/api/v1/templates/{id}/versions/{version}'] = {
    get: {
      operationId: 'getTemplateVersion',
      tags: ['templates'],
      description: 'Reads one exact template business version.',
      security: [{ bearerAuth: [], appCheck: [], agency: [] }],
      parameters: templateParameters(true),
      responses: { '200': { description: 'Exact template version' }, '404': { $ref: '#/components/responses/Error' } },
      'x-required-capability': 'report.read',
    },
    put: {
      operationId: 'updateTemplateDraft',
      tags: ['templates'],
      description: 'Replaces an editable draft using expectedRecordVersion optimistic locking. Published and retired versions are immutable.',
      security: [{ bearerAuth: [], appCheck: [], agency: [] }],
      parameters: [...templateParameters(true), { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedRecordVersion', 'template'], properties: { expectedRecordVersion: { type: 'integer', minimum: 1 }, template: { type: 'object', additionalProperties: true } } } } } },
      responses: { '200': { description: 'Draft updated' }, '400': { $ref: '#/components/responses/Error' }, '409': { $ref: '#/components/responses/Error' } },
      'x-required-capability': 'template.manage',
    },
  };
  paths['/api/v1/templates/{id}/versions/{version}/actions/{action}'] = {
    post: {
      operationId: 'transitionTemplateVersion',
      tags: ['templates'],
      description: 'Publishes, duplicates or retires an exact template version. Publishing makes the version immutable and updates the logical published pointer used for new reports.',
      security: [{ bearerAuth: [], appCheck: [], agency: [] }],
      parameters: [...templateParameters(true, true), { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expectedRecordVersion'], properties: { expectedRecordVersion: { type: 'integer', minimum: 1 } } } } } },
      responses: { '200': { description: 'Template lifecycle action completed' }, '201': { description: 'New draft version created by duplicate' }, '400': { $ref: '#/components/responses/Error' }, '409': { $ref: '#/components/responses/Error' } },
      'x-required-capability': 'template.manage',
    },
  };

  paths['/api/v1/inspection-jobs/{id}/transitions'] = {
    post: {
      ...operation('inspection-jobs', 'post', false),
      operationId: 'transitionInspectionJob',
      responses: { '200': { description: 'Workflow transition completed' }, '409': { $ref: '#/components/responses/Error' } },
    },
  };
  paths['/api/v1/inspection-jobs/{id}/create-report'] = {
    post: {
      ...operation('inspection-jobs', 'post', false),
      operationId: 'createInspectionReportForJob',
      description: 'Creates or safely reuses the server-authoritative report linked to an inspection job. The server resolves the canonical Entry, Routine, Exit, Comparison or Maintenance policy, binds a published template version, and for Exit binds the eligible immutable Entry baseline for the same property and tenancy.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['expectedJobVersion', 'areas'],
              properties: {
                expectedJobVersion: { type: 'integer', minimum: 1 },
                reportType: { type: 'string' },
                clientName: { type: 'string' },
                inspectionDate: { type: 'string', format: 'date' },
                areas: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Existing linked report safely reused' },
        '201': { description: 'Inspection report created and linked to the job' },
        '400': { $ref: '#/components/responses/Error' },
        '409': { $ref: '#/components/responses/Error' },
        '422': { $ref: '#/components/responses/Error' },
      },
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
  paths['/api/v1/reports/{id}/archive-artifact'] = {
    post: {
      ...operation('reports', 'post', false),
      operationId: 'createReportArchiveArtifact',
      description: 'Creates or reuses the immutable, version-bound archive manifest for a finalised report. This command does not itself transition the report to archived.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['expectedVersion'],
              properties: { expectedVersion: { type: 'integer', minimum: 1 } },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Existing immutable archive artifact reused' },
        '201': { description: 'Immutable archive artifact created' },
        '409': { $ref: '#/components/responses/Error' },
        '422': { $ref: '#/components/responses/Error' },
      },
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
