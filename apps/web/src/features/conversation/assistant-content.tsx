import { MarkdownContent } from './markdown-content';

// Keep message layout and attempt lifecycle independent of content rendering.
// Future validated image/content blocks can be composed at this boundary.
export function AssistantContent({ text }: { text: string }) {
  return <MarkdownContent text={text} />;
}
