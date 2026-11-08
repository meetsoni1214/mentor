import { z } from 'zod';
import type { RunLimits } from '../conversation/index.js';

export type AIEnvironment =
  | { enabled: false; invalidKeys: string[] }
  | { enabled: true; apiKey: string; limits: RunLimits };

const configuration = z
  .object({
    OPENAI_API_KEY: z.string().trim().min(1).max(4096).regex(/^\S+$/),
    OPENAI_CHAT_MODEL: z.string().trim().min(1).max(200).regex(/^\S+$/),
    AI_MAX_MESSAGE_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_536)
      .default(8192),
    AI_MAX_CONTEXT_BYTES: z.coerce
      .number()
      .int()
      .min(128)
      .max(262_144)
      .default(32_768),
    AI_MAX_OUTPUT_TOKENS: z.coerce
      .number()
      .int()
      .min(1)
      .max(32_768)
      .default(2048),
    AI_DEADLINE_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(300_000)
      .default(60_000),
    AI_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(10).default(2),
  })
  .refine((value) => value.AI_MAX_CONTEXT_BYTES >= value.AI_MAX_MESSAGE_BYTES, {
    path: ['AI_MAX_CONTEXT_BYTES'],
  });

export function readAIEnvironment(
  values: NodeJS.ProcessEnv = process.env,
): AIEnvironment {
  const result = configuration.safeParse(values);
  if (!result.success) {
    return {
      enabled: false,
      invalidKeys: [
        ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
      ],
    };
  }
  const config = result.data;
  return {
    enabled: true,
    apiKey: config.OPENAI_API_KEY,
    limits: {
      model: config.OPENAI_CHAT_MODEL,
      allowedTools: ['web_search'],
      maxMessageBytes: config.AI_MAX_MESSAGE_BYTES,
      maxContextBytes: config.AI_MAX_CONTEXT_BYTES,
      maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS,
      deadlineMs: config.AI_DEADLINE_MS,
      maxToolCalls: config.AI_MAX_TOOL_CALLS,
    },
  };
}
