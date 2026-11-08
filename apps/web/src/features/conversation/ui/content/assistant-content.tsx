import { MarkdownContent } from './markdown-content';
import type { AnswerSource } from './citation-markdown';

// Keep message layout and attempt lifecycle independent of content rendering.
// Future validated image/content blocks can be composed at this boundary.
export function AssistantContent({
  text,
  sources = [],
}: {
  text: string;
  sources?: readonly AnswerSource[];
}) {
  return <MarkdownContent text={text} sources={sources} />;
}
