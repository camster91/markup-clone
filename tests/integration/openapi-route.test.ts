import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/openapi.json/route';

describe('GET /api/v1/openapi.json', () => {
  it('serves the supported public contract without authentication', async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/api/v1/projects/{projectId}/issues'].get).toBeDefined();
    expect(body.paths['/api/v1/projects/{projectId}/issues'].post).toBeUndefined();
  });
});
