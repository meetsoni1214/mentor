import { describe, expect, it } from 'vitest';
import {
  readDatabaseEnvironment,
  readServiceEnvironment,
} from '../../packages/backend/src/config/environment.js';

describe('service configuration', () => {
  it('uses separate loopback-bound ports for the API and worker', () => {
    expect(readServiceEnvironment({})).toMatchObject({
      HOST: '127.0.0.1',
      API_PORT: 3001,
      WORKER_PORT: 3002,
    });
  });

  it.each(['0', '65536', 'not-a-number'])(
    'rejects an invalid port: %s',
    (API_PORT) => {
      expect(() => readServiceEnvironment({ API_PORT })).toThrow('API_PORT');
    },
  );

  it('rejects a missing database URL', () => {
    expect(() => readDatabaseEnvironment({})).toThrow('DATABASE_URL');
  });

  it('rejects other protocols without echoing a password', () => {
    expect(() =>
      readDatabaseEnvironment({
        DATABASE_URL: 'https://owner:private-password@example.com/db',
      }),
    ).toThrow('Invalid environment configuration: DATABASE_URL');
  });

  it('bounds the database pool and connection timeout', () => {
    expect(() =>
      readDatabaseEnvironment({
        DATABASE_URL: 'postgresql://localhost/mentor',
        DATABASE_POOL_MAX: '0',
      }),
    ).toThrow('DATABASE_POOL_MAX');
    expect(() =>
      readDatabaseEnvironment({
        DATABASE_URL: 'postgresql://localhost/mentor',
        DATABASE_CONNECT_TIMEOUT_MS: '0',
      }),
    ).toThrow('DATABASE_CONNECT_TIMEOUT_MS');
  });
});
