import { describe, expect, it } from 'vitest';
import { readAIEnvironment } from '../../packages/backend/src/config/ai.environment.js';
import type { RunLimits } from '../../packages/backend/src/conversation/application/conversation.contracts.js';

const configured = {
  OPENAI_API_KEY: 'synthetic-server-key',
  OPENAI_CHAT_MODEL: 'synthetic-model',
};

describe('server-only AI configuration', () => {
  it.each(['OPENAI_API_KEY', 'OPENAI_CHAT_MODEL'])(
    'requires an explicit nonempty %s',
    (key) => {
      for (const value of [undefined, '', '  ', 'has internal whitespace']) {
        expect(readAIEnvironment({ ...configured, [key]: value })).toEqual({
          enabled: false,
          invalidKeys: [key],
        });
      }
    },
  );

  it('keeps execution unavailable when model and key are missing', () => {
    expect(readAIEnvironment({})).toEqual({
      enabled: false,
      invalidKeys: ['OPENAI_API_KEY', 'OPENAI_CHAT_MODEL'],
    });
  });

  it('automatically enables complete configuration, with finite defaults and no available tools', () => {
    expect(readAIEnvironment(configured)).toEqual({
      enabled: true,
      apiKey: configured.OPENAI_API_KEY,
      limits: {
        model: configured.OPENAI_CHAT_MODEL,
        allowedTools: [],
        maxMessageBytes: 8192,
        maxContextBytes: 32768,
        maxOutputTokens: 2048,
        deadlineMs: 60000,
        maxToolCalls: 2,
      },
    });
  });

  it.each<{
    key: string;
    field: keyof RunLimits;
    minimum: number;
    maximum: number;
  }>([
    {
      key: 'AI_MAX_MESSAGE_BYTES',
      field: 'maxMessageBytes',
      minimum: 1,
      maximum: 65536,
    },
    {
      key: 'AI_MAX_CONTEXT_BYTES',
      field: 'maxContextBytes',
      minimum: 128,
      maximum: 262144,
    },
    {
      key: 'AI_MAX_OUTPUT_TOKENS',
      field: 'maxOutputTokens',
      minimum: 1,
      maximum: 32768,
    },
    {
      key: 'AI_DEADLINE_MS',
      field: 'deadlineMs',
      minimum: 100,
      maximum: 300000,
    },
    {
      key: 'AI_MAX_TOOL_CALLS',
      field: 'maxToolCalls',
      minimum: 1,
      maximum: 10,
    },
  ])(
    'accepts inclusive bounds and rejects unsafe $key',
    ({ key, field, minimum, maximum }) => {
      const base = {
        ...configured,
        AI_MAX_MESSAGE_BYTES: '1',
        AI_MAX_CONTEXT_BYTES: '262144',
      };
      for (const value of [minimum, maximum]) {
        const config = readAIEnvironment({ ...base, [key]: String(value) });
        expect(config.enabled).toBe(true);
        if (!config.enabled) throw new Error('Expected enabled fixture');
        expect(config.limits[field]).toBe(value);
      }
      for (const value of [
        '',
        'invalid',
        'NaN',
        'Infinity',
        '1.5',
        String(minimum - 1),
        String(maximum + 1),
      ]) {
        expect(readAIEnvironment({ ...base, [key]: value })).toEqual({
          enabled: false,
          invalidKeys: [key],
        });
      }
    },
  );

  it('rejects a context budget smaller than the raw message limit', () => {
    expect(
      readAIEnvironment({ ...configured, AI_MAX_CONTEXT_BYTES: '8191' }),
    ).toEqual({
      enabled: false,
      invalidKeys: ['AI_MAX_CONTEXT_BYTES'],
    });
  });

  it('returns only redacted key names for invalid values', () => {
    const config = readAIEnvironment({
      ...configured,
      OPENAI_API_KEY: 'private key that cannot be an HTTP credential',
      OPENAI_CHAT_MODEL: 'private model details with spaces',
      AI_MAX_OUTPUT_TOKENS: 'private invalid value',
      UNRELATED_SECRET: 'another private value',
    });
    expect(config).toEqual({
      enabled: false,
      invalidKeys: [
        'OPENAI_API_KEY',
        'OPENAI_CHAT_MODEL',
        'AI_MAX_OUTPUT_TOKENS',
      ],
    });
    expect(JSON.stringify(config)).not.toContain('private');
    expect(
      readAIEnvironment({
        ...configured,
        AI_MAX_OUTPUT_TOKENS: 'private invalid value',
      }),
    ).toEqual({
      enabled: false,
      invalidKeys: ['AI_MAX_OUTPUT_TOKENS'],
    });
  });
});
