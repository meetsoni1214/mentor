import createClient from 'openapi-fetch';
import type { paths } from './generated/schema.js';

export function createApiClient(baseUrl = '') {
  return createClient<paths>({ baseUrl, credentials: 'same-origin' });
}

export type { paths, components } from './generated/schema.js';
