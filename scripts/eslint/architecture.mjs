import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = 'packages/backend/src/';
const manifest = JSON.parse(
  readFileSync(
    new URL('../../packages/backend/package.json', import.meta.url),
    'utf8',
  ),
);
// The package manifest is also the source of truth for internal module entry files.
const entries = new Map(
  Object.entries(manifest.exports).map(([key, value]) => [
    `@mentor/backend/${key.slice(2)}`,
    `${backend}${value.import.slice('./dist/'.length).replace(/\.js$/, '.ts')}`,
  ]),
);
const publicFiles = new Set(entries.values());

function sourceFile(filename) {
  return relative(root, filename).replaceAll('\\', '/');
}

function resolveImport(filename, specifier) {
  if (entries.has(specifier)) return entries.get(specifier);
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    return sourceFile(resolve(dirname(filename), specifier)).replace(
      /\.js$/,
      '.ts',
    );
  }
  return null;
}

export default {
  rules: {
    'import-boundaries': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          browser:
            'Web code must use @mentor/api-client; backend and database implementations belong on the server.',
          entry:
            'Use a declared @mentor/backend subpath; root and private package imports are not supported.',
          package:
            'Import backend code through a declared @mentor/backend subpath instead of its source or build files.',
          core: 'Domain and application code may depend only on their own core. Application boundary validation may also use Zod.',
          private:
            'Cross-module imports must use a declared public entry file.',
        },
      },
      create(context) {
        const filename = context.filename;
        const from = sourceFile(filename);
        const fromBackend = from.startsWith(backend);
        const fromModule = fromBackend
          ? from.slice(backend.length).split('/')[0]
          : null;
        const core = from.match(
          /^packages\/backend\/src\/(identity|conversation)\/(domain\/|application\/|index\.ts$)/,
        );

        function check(node, specifier) {
          if (typeof specifier !== 'string') return;
          const target = resolveImport(filename, specifier);
          let messageId;
          if (
            (from.startsWith('apps/web/') ||
              from.startsWith('packages/api-client/')) &&
            (specifier === '@mentor/backend' ||
              specifier.startsWith('@mentor/backend/') ||
              target?.startsWith('packages/backend/') ||
              target?.startsWith('apps/api/') ||
              target?.startsWith('apps/worker/') ||
              /^(?:@nestjs\/|drizzle-orm(?:\/|$)|pg(?:\/|$))/.test(specifier))
          ) {
            messageId = 'browser';
          } else if (
            (specifier === '@mentor/backend' ||
              specifier.startsWith('@mentor/backend/')) &&
            !entries.has(specifier)
          ) {
            messageId = 'entry';
          } else if (
            !fromBackend &&
            !from.startsWith('tests/unit/') &&
            target?.startsWith('packages/backend/') &&
            !(from.startsWith('packages/backend/') && publicFiles.has(target))
          ) {
            // Named package imports have already been resolved to an allowed entry.
            if (!entries.has(specifier)) messageId = 'package';
          } else if (
            fromBackend &&
            target?.startsWith('packages/backend/') &&
            !target.startsWith(backend)
          ) {
            messageId = 'private';
          } else if (core) {
            const layer = core[2] === 'domain/' ? 'domain' : 'application';
            const moduleRoot = `${backend}${core[1]}/`;
            const allowed =
              target?.startsWith(`${moduleRoot}domain/`) ||
              (layer === 'application' &&
                target?.startsWith(`${moduleRoot}application/`)) ||
              (layer === 'application' && specifier === 'zod');
            if (!allowed) messageId = 'core';
          } else if (fromBackend && target?.startsWith(backend)) {
            const targetModule = target.slice(backend.length).split('/')[0];
            if (fromModule !== targetModule && !publicFiles.has(target))
              messageId = 'private';
          } else if (fromBackend && target?.startsWith('apps/')) {
            messageId = 'private';
          }
          if (messageId) context.report({ node, messageId });
        }

        return {
          ImportDeclaration: (node) => check(node.source, node.source.value),
          ExportNamedDeclaration: (node) => {
            if (node.source) check(node.source, node.source.value);
          },
          ExportAllDeclaration: (node) => check(node.source, node.source.value),
          ImportExpression: (node) => check(node.source, node.source.value),
          TSImportType: (node) => check(node.source, node.source.value),
          CallExpression: (node) => {
            if (
              node.callee.type === 'Identifier' &&
              node.callee.name === 'require'
            )
              check(node, node.arguments[0]?.value);
          },
        };
      },
    },
  },
};
