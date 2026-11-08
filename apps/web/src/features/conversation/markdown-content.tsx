import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdown-content">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
