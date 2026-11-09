import type { components } from '@mentor/api-client';
import { parseMemoryCommand } from '@mentor/memory-command';
import { z } from 'zod';

export { memoryLimits, wordingBytes as bytes } from '@mentor/memory-command';
export type MemoryEntry = components['schemas']['MemoryEntryDto'];
export type MemorySnapshot = components['schemas']['MemorySnapshotDto'];
export type SaveMemoryInput = components['schemas']['SaveMemoryDto'];

export function memoryCommand(sourceRequest: string) {
  const command = parseMemoryCommand(sourceRequest);
  return (
    command && {
      text: command.text,
      error: command.valid
        ? null
        : command.text
          ? 'Please shorten or rephrase this memory.'
          : 'Enter something to remember.',
    }
  );
}

// Validate the wire shape; capacity and wording/provenance policy belong to the server.
export const memoryEntrySchema: z.ZodType<MemoryEntry> = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  text: z.string(),
  sourceRequest: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export const memorySnapshotSchema: z.ZodType<MemorySnapshot> = z.object({
  entries: z.array(memoryEntrySchema),
  limits: z.object({
    maxEntries: z.number().int().positive(),
    maxEntryBytes: z.number().int().positive(),
    maxProfileBytes: z.number().int().positive(),
    maxRequestBytes: z.number().int().positive(),
  }),
});
