import { createRequire } from 'node:module';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
const ruleId = 'architecture/import-boundaries';
const core =
  'packages/backend/src/conversation/application/conversation-loop.ts';
const domain = 'packages/backend/src/conversation/domain/conversation.ts';
const repository =
  'packages/backend/src/conversation/adapters/drizzle-conversation.repository.ts';
const web = 'apps/web/src/features/auth/auth-api.ts';
const composition = 'apps/api/src/identity/infrastructure/identity.module.ts';

async function boundaries(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  expect(result?.fatalErrorCount).toBe(0);
  return result?.messages.filter((message) => message.ruleId === ruleId);
}

describe('enforced architecture boundaries', () => {
  it.each([
    [web, "import '@mentor/backend/identity';", 'browser'],
    [
      web,
      "export * from '../../../../../packages/backend/src/identity/index.js';",
      'browser',
    ],
    [web, "import('drizzle-orm');", 'browser'],
    [
      'packages/api-client/src/index.ts',
      "export * from '@mentor/backend/identity';",
      'browser',
    ],
    [web, "import '../../../../../apps/api/src/app.module.js';", 'browser'],
    [composition, "import '@mentor/backend';", 'entry'],
    [
      composition,
      "import '@mentor/backend/src/identity/application/sessions.js';",
      'entry',
    ],
    [
      composition,
      "import '../../../../../packages/backend/src/identity/index.js';",
      'package',
    ],
    [
      composition,
      "import '../../../../../packages/backend/dist/identity/index.js';",
      'package',
    ],
    [core, "import { Injectable } from '@nestjs/common';", 'core'],
    [
      core,
      "export * from '../adapters/drizzle-conversation.repository.js';",
      'core',
    ],
    [
      core,
      "import type { DatabaseConnection } from '../../database/index.js';",
      'core',
    ],
    [
      core,
      "type Connection = import('../../database/index.js').DatabaseConnection;",
      'core',
    ],
    [core, "import('@mentor/backend/conversation/persistence');", 'core'],
    [core, "import '../domain/../../config/environment.js';", 'core'],
    [domain, "import '../application/conversation.contracts.js';", 'core'],
    [domain, "import 'zod';", 'core'],
    [domain, "require('pg');", 'core'],
    [
      'packages/backend/src/identity/index.ts',
      "export * from './crypto.js';",
      'core',
    ],
    [
      repository,
      "import '../../identity/adapters/driven/persistence/drizzle/owner.schema.js';",
      'private',
    ],
    [repository, "import '../../identity/application/sessions.js';", 'private'],
    [repository, "import '../../../dist/identity/persistence.js';", 'private'],
    [
      repository,
      "import '../../../../../apps/api/src/app.module.js';",
      'private',
    ],
    [
      'tests/integration/conversation.test.ts',
      "import '../../packages/backend/src/conversation/domain/conversation.js';",
      'package',
    ],
    [
      'packages/backend/drizzle.config.ts',
      "import './src/identity/application/sessions.js';",
      'package',
    ],
  ])('rejects %s importing %s', async (file, code, messageId) => {
    expect(await boundaries(file, code)).toMatchObject([{ messageId }]);
  });

  it.each([
    [web, "import '@mentor/api-client';"],
    [
      composition,
      "import '@mentor/backend/identity'; import '@mentor/backend/identity/crypto'; import '@mentor/backend/identity/persistence'; import '@mentor/backend/database/nest';",
    ],
    [
      core,
      "import '../domain/conversation.js'; import './ports/conversation.repository.js'; import 'zod';",
    ],
    [domain, "import './admission-policy.js';"],
    [
      repository,
      "import '../../identity/schema.js'; import '../../database/index.js'; import 'drizzle-orm';",
    ],
    [
      'packages/backend/src/database/schema.ts',
      "export * from '../identity/schema.js'; export * from '../conversation/adapters/conversation.schema.js';",
    ],
    [
      'tests/unit/conversation-mapper.test.ts',
      "import '../../packages/backend/src/conversation/adapters/conversation.mapper.js';",
    ],
    [
      'packages/backend/drizzle.config.ts',
      "import './src/config/environment.js';",
    ],
    [
      'tests/integration/conversation.test.ts',
      "import '@mentor/backend/conversation'; import '@mentor/backend/conversation/persistence';",
    ],
  ])('allows %s importing %s', async (file, code) => {
    expect(await boundaries(file, code)).toEqual([]);
  });

  it.each([
    '@mentor/backend',
    '@mentor/backend/src/identity/application/sessions.js',
    '@mentor/backend/dist/conversation/adapters/drizzle-conversation.repository.js',
  ])('also blocks unsupported package imports at runtime: %s', (specifier) => {
    const require = createRequire(import.meta.url);
    expect(() => require.resolve(specifier)).toThrow(
      expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }),
    );
  });
});
