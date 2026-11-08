import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { citationMarkdown } from './citation-markdown';
import type { AnswerSource } from './citation-markdown';

const components: Components = {
  // Generated prose is not a verified source or permission to fetch an asset.
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
  h1: ({ children }) => <h2>{children}</h2>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h5>{children}</h5>,
  h5: ({ children }) => <h6>{children}</h6>,
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  table: ({ children }) => (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label="Response table"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
};

export function MarkdownContent({
  text,
  sources = [],
}: {
  text: string;
  sources?: readonly AnswerSource[];
}) {
  const citations = citationMarkdown(text, sources);
  const withCitations: Components = {
    ...components,
    a: ({ node, children }) => {
      const link = citations.links.get(node?.position?.start.offset ?? -1);
      // A matching URL or model-written citation token is insufficient. Only a
      // link inserted at a validated annotation's exact location is clickable.
      if (!link || node?.position?.end.offset !== link.end)
        return <span>{children}</span>;
      return (
        <a
          className="answer-citation"
          href={link.source.url}
          target="_blank"
          rel="noopener noreferrer"
          title={link.source.title}
          aria-label={`Source ${link.source.number}: ${link.source.title}`}
        >
          [{link.source.number}]
        </a>
      );
    },
  };
  return (
    <div className="markdown-content">
      <Markdown remarkPlugins={[remarkGfm]} components={withCitations}>
        {citations.markdown}
      </Markdown>
      {citations.sources.length > 0 && (
        <ul className="answer-sources" aria-label="Response sources">
          {citations.sources.map((source) => (
            <li key={source.number}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                [{source.number}] {source.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
