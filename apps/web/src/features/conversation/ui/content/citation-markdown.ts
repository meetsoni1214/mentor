import { sourceSchema } from '../../api/conversation-contracts';
import type { ConversationHistory } from '../../api/conversation-contracts';

export type AnswerSource =
  ConversationHistory['turns'][number]['attempts'][number]['sources'][number];

export function citationMarkdown(
  text: string,
  sources: readonly AnswerSource[],
) {
  const validated = sources.slice(0, 20).flatMap((source, index) => {
    const parsed = sourceSchema.safeParse(source);
    return parsed.success ? [{ ...parsed.data, number: index + 1 }] : [];
  });
  const positions = validated
    .flatMap((source) => {
      const { startIndex, endIndex } = source;
      if (startIndex === undefined || endIndex === undefined) return [];
      return [{ ...source, startIndex, endIndex }];
    })
    .sort((a, b) => a.startIndex - b.startIndex);
  const links = new Map<
    number,
    { end: number; source: (typeof validated)[number] }
  >();
  const groups: Array<{
    startIndex: number;
    endIndex: number;
    sources: typeof validated;
  }> = [];
  for (const source of positions) {
    const previous = groups.at(-1);
    if (
      previous?.startIndex === source.startIndex &&
      previous.endIndex === source.endIndex
    )
      previous.sources.push(source);
    else if (!previous || source.startIndex >= previous.endIndex)
      groups.push({ ...source, sources: [source] });
  }
  let markdown = '';
  let cursor = 0;
  for (const group of groups) {
    markdown += text.slice(cursor, group.startIndex);
    const annotated = text.slice(group.startIndex, group.endIndex);
    // Remove only an actual annotated provider marker, never cited answer text.
    if (!/^\uE200cite\uE202[^\uE201]*\uE201$/u.test(annotated))
      markdown += annotated + ' ';
    for (const source of group.sources) {
      const link = `[${source.number}](#mentor-citation-${source.number})`;
      links.set(markdown.length, {
        end: markdown.length + link.length,
        source,
      });
      markdown += link;
    }
    cursor = group.endIndex;
  }
  markdown += text.slice(cursor);
  return { markdown, links, sources: validated };
}
