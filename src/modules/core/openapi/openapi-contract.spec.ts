import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type HttpMethod = 'get' | 'post' | 'patch';

type EndpointExpectation = {
  path: string;
  method: HttpMethod;
  expectsRequestBody: boolean;
};

const CRITICAL_ENDPOINTS: EndpointExpectation[] = [
  {
    path: '/leagues/{leagueId}/matches/{matchId}/result',
    method: 'patch',
    expectsRequestBody: true,
  },
  {
    path: '/leagues/{leagueId}/report-manual',
    method: 'post',
    expectsRequestBody: true,
  },
  {
    path: '/leagues/{leagueId}/report-from-reservation',
    method: 'post',
    expectsRequestBody: true,
  },
  {
    path: '/competitive/profile/me/history',
    method: 'get',
    expectsRequestBody: false,
  },
  {
    path: '/competitive/ranking',
    method: 'get',
    expectsRequestBody: false,
  },
  {
    path: '/challenges/inbox',
    method: 'get',
    expectsRequestBody: false,
  },
  {
    path: '/public/leagues/{id}/standings',
    method: 'get',
    expectsRequestBody: false,
  },
  {
    path: '/public/leagues/{id}/og',
    method: 'get',
    expectsRequestBody: false,
  },
];

describe('OpenAPI contract snapshot (critical endpoints)', () => {
  it('contains the expected critical endpoints with basic operation contract metadata', () => {
    const snapshotPath = resolve(process.cwd(), 'openapi.snapshot.json');
    expect(existsSync(snapshotPath)).toBe(true);

    const document = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      paths?: Record<string, Record<string, any>>;
    };

    expect(document.paths).toBeDefined();

    for (const endpoint of CRITICAL_ENDPOINTS) {
      const pathItem = document.paths?.[endpoint.path];
      expect(pathItem).toBeDefined();

      const operation = pathItem?.[endpoint.method];
      expect(operation).toBeDefined();

      if (endpoint.expectsRequestBody) {
        expect(operation.requestBody).toBeDefined();
      }

      expect(operation.responses).toBeDefined();
      expect(Object.keys(operation.responses ?? {})).not.toHaveLength(0);
    }
  });
});

