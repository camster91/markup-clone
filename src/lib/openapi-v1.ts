export const OPENAPI_V1 = {
  openapi: '3.1.0',
  info: { title: 'Ashbi Visual Feedback API', version: '1.0.0', description: 'Read-only project-scoped structured visual feedback.' },
  paths: {
    '/api/v1/projects/{projectId}/issues': {
      get: {
        operationId: 'listProjectIssues', summary: 'List structured issues for one project',
        security: [{ developerBearer: [] }],
        parameters: [
          { name: 'projectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['OPEN', 'RESOLVED'] } },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] } },
          ...['assigneeId', 'tagId', 'reviewRoundId'].map((name) => ({ name, in: 'query', schema: { type: 'string', format: 'uuid' } })),
        ],
        responses: {
          '200': { description: 'Bounded visual-feedback.issue.v1 payloads', content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueList' } } } },
          '400': { $ref: '#/components/responses/ApiError' }, '401': { $ref: '#/components/responses/ApiError' }, '429': { $ref: '#/components/responses/ApiError' },
        },
      },
    },
  },
  components: {
    securitySchemes: { developerBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'mkv1 project token' } },
    responses: { ApiError: { description: 'Machine-readable API error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } } },
    schemas: {
      IssueList: {
        type: 'object', required: ['apiVersion', 'data', 'pagination'],
        properties: {
          apiVersion: { const: 'v1' }, data: { type: 'array', items: { $ref: '#/components/schemas/Issue' } },
          pagination: { type: 'object', required: ['limit', 'nextCursor'], properties: { limit: { type: 'integer' }, nextCursor: { type: ['string', 'null'], format: 'uuid' } } },
        },
      },
      Issue: { type: 'object', required: ['schema', 'title', 'pin', 'project', 'page', 'reviewUrl', 'comments'], properties: { schema: { const: 'visual-feedback.issue.v1' }, title: { type: 'string' }, pin: { type: 'object' }, project: { type: 'object' }, page: { type: 'object' }, reviewUrl: { type: 'string', format: 'uri' }, comments: { type: 'array', items: { type: 'object' } } } },
      ErrorEnvelope: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
    },
  },
} as const;
