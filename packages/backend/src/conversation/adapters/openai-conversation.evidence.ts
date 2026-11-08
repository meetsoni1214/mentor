import { z } from 'zod';
import type { RunActivity, SourceReference } from '../domain/conversation.js';

const citation = z.object({
  type: z.literal('url_citation'),
  title: z.string().trim().min(1).max(500),
  url: z.string().min(1).max(2048),
  start_index: z.number().int().nonnegative(),
  end_index: z.number().int().positive(),
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validatedSourceURL(value: string): string | undefined {
  if (/\s/.test(value) || value.includes('\\')) return undefined;
  if (
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return undefined;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 2048
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function textParts(
  content: unknown,
): Array<{ text: string; annotations: unknown }> {
  if (!Array.isArray(content)) return [];
  return content.flatMap((value) => {
    const part = record(value);
    return part?.type === 'output_text' && typeof part.text === 'string'
      ? [
          {
            text: part.text,
            annotations: record(part.providerData)?.annotations,
          },
        ]
      : [];
  });
}

function citationRange(text: string, start: number, end: number) {
  if (start >= end || end > text.length) return undefined;
  let startIndex = start;
  let endIndex = end;
  const marker = /^\uE200cite\uE202[^\uE201]*\uE201$/u;
  // Some provider offsets can count Unicode characters rather than JS code
  // units. Translate only when an exact provider marker proves its location.
  if (!marker.test(text.slice(start, end))) {
    const characters = [...text];
    if (characters.length !== text.length && end <= characters.length) {
      const candidateStart = characters.slice(0, start).join('').length;
      const candidateEnd = characters.slice(0, end).join('').length;
      if (marker.test(text.slice(candidateStart, candidateEnd))) {
        startIndex = candidateStart;
        endIndex = candidateEnd;
      }
    }
  }
  if (
    [startIndex, endIndex].some((index) => {
      const code = text.charCodeAt(index);
      return code >= 0xdc00 && code <= 0xdfff;
    })
  )
    return undefined;
  return { startIndex, endIndex };
}

// SDK/provider metadata is untrusted. Persist only bounded application evidence,
// never the raw responses, queries, page content, or reasoning carried by a run.
export function normalizeWebEvidence(
  responses: ReadonlyArray<{ output: readonly unknown[] }>,
  answer: string,
  searchAvailable: boolean,
): { sources: SourceReference[]; activity: RunActivity[] } {
  const sources: Array<
    SourceReference & { startIndex: number; endIndex: number }
  > = [];
  const activity: RunActivity[] = [];
  if (!searchAvailable) return { sources, activity };
  const calls = new Set<string>();
  let completedSearch = false;
  for (const response of responses) {
    for (const value of response.output) {
      const item = record(value);
      const data = record(item?.providerData);
      const action = record(data?.action);
      if (
        item?.type !== 'hosted_tool_call' ||
        item.name !== 'web_search_call' ||
        data?.type !== 'web_search_call' ||
        typeof item.id !== 'string' ||
        !item.id ||
        typeof action?.type !== 'string' ||
        !['search', 'open_page', 'find_in_page'].includes(action.type) ||
        (item.status !== 'completed' && item.status !== 'failed')
      )
        continue;
      if (item.status === 'completed') completedSearch = true;
      if (calls.has(item.id) || activity.length >= 20) continue;
      calls.add(item.id);
      activity.push({ type: 'web_search', status: item.status });
    }
  }
  if (!completedSearch) return { sources, activity };

  // Only annotate the text that actually became the SDK's final answer. Earlier
  // messages can be commentary or intermediate output from a different step.
  const messages = (responses.at(-1)?.output ?? [])
    .map(record)
    .filter((item) => item?.type === 'message' && item.role === 'assistant')
    .flatMap((item) => {
      const parts = textParts(item?.content);
      return [{ text: parts.map((part) => part.text).join(''), parts }];
    });
  const exact = messages.findLast((message) => message.text === answer);
  const selected = exact ? [exact] : messages;
  if (selected.map((message) => message.text).join('') !== answer)
    return { sources, activity };

  let offset = 0;
  for (const message of selected) {
    for (const part of message.parts) {
      const { text, annotations } = part;
      if (Array.isArray(annotations)) {
        for (const annotation of annotations) {
          if (sources.length >= 20) break;
          const parsed = citation.safeParse(annotation);
          if (!parsed.success) continue;
          const data = parsed.data;
          const url = validatedSourceURL(data.url);
          const range = citationRange(text, data.start_index, data.end_index);
          if (!url || !range) continue;
          const startIndex = offset + range.startIndex;
          const endIndex = offset + range.endIndex;
          // Several URLs can cite one marker; conflicting ranges are ambiguous.
          if (
            sources.some((source) =>
              startIndex === source.startIndex && endIndex === source.endIndex
                ? url === source.url
                : startIndex < source.endIndex && endIndex > source.startIndex,
            )
          )
            continue;
          sources.push({ title: data.title, url, startIndex, endIndex });
        }
      }
      offset += text.length;
    }
  }
  sources.sort((left, right) => left.startIndex - right.startIndex);
  return { sources, activity };
}
