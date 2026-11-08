import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantContent } from '../src/features/conversation/ui/content/assistant-content';
import { ConversationMessage } from '../src/features/conversation/ui/conversation-message';
import { completed, running } from './fixtures/conversation-stream';

const render = (text: string) =>
  renderToStaticMarkup(createElement(AssistantContent, { text }));

describe('assistant content', () => {
  it('renders paragraphs, emphasis and nested lists as semantic content', () => {
    const html = render(
      'Here is the basic idea:\n\n- **Training:** patterns\n- *Context:* your message\n  - A nested item\n\n1. First step\n2. Second step',
    );
    expect(html).toContain('<p>Here is the basic idea:</p>');
    expect(html).toContain('<strong>Training:</strong>');
    expect(html).toContain('<em>Context:</em>');
    expect(html).toContain('<ul>\n<li>A nested item</li>\n</ul>');
    expect(html).toContain('<ol>\n<li>First step</li>');
    expect(html).not.toContain('**Training:**');
  });

  it('renders headings, quotes, code and GFM tables with scrollable boundaries', () => {
    const html = render(
      '# Explanation\n\n> A quote\n\nUse `const` here.\n\n```ts\nconst x = "<tag>";\n```\n\n| Item | Value |\n| --- | --- |\n| One | Two |\n\n~~Removed~~\n\n- [x] Done',
    );
    expect(html).toContain('<h2>Explanation</h2>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<code>const</code>');
    expect(html).toContain('<pre tabindex="0"><code class="language-ts">');
    expect(html).toContain('&lt;tag&gt;');
    expect(html).toContain(
      'role="region" aria-label="Response table" tabindex="0"',
    );
    expect(html).toContain('<th>Item</th>');
    expect(html).toContain('<del>Removed</del>');
    expect(html).toContain('type="checkbox" disabled="" checked=""');
  });

  it('keeps HTML inert and never turns prose into navigable links or fetched images', () => {
    const html = render(
      '<script>alert(1)</script>\n\n<img src="https://tracking.test/pixel" onerror="alert(1)">\n\n[Example](https://example.test) [Unsafe](javascript:alert%281%29)\n\nhttps://example.test\n\n![Diagram](https://tracking.test/image.png)',
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<span>Example</span>');
    expect(html).toContain('<span>Unsafe</span>');
    expect(html).toContain('[Image: Diagram]');
    expect(html).not.toMatch(/<(script|img|a|link)\b/);
    expect(html).not.toContain('href=');
  });

  it('tolerates incomplete Markdown while streaming and formats the completed text', () => {
    expect(render('Starting **a response')).toContain('Starting **a response');
    expect(render('Starting **a response**')).toContain(
      '<strong>a response</strong>',
    );
    expect(render('```ts\nconst value =')).toContain('const value =');
  });

  it('uses the same renderer for completed and provisional answers, leaving owner input literal', () => {
    const text = '**Formatted answer**';
    const turn = { ...completed.turn, text: '**Literal input**' };
    const final = renderToStaticMarkup(
      createElement(ConversationMessage, {
        turn: { ...turn, attempts: [{ ...completed.attempt, answer: text }] },
        refreshing: false,
        onRefresh: () => {},
        provisional: null,
      }),
    );
    const partial = renderToStaticMarkup(
      createElement(ConversationMessage, {
        turn: { ...turn, attempts: [running.attempt] },
        refreshing: false,
        onRefresh: () => {},
        provisional: {
          historyVersion: running.historyVersion,
          turnId: turn.id,
          attemptId: running.attempt.id,
          text,
        },
      }),
    );
    for (const html of [final, partial]) {
      expect(html).toContain('<strong>Formatted answer</strong>');
      expect(html).toContain('>**Literal input**</div>');
    }
    expect(partial).toContain('Responding…');
    expect(final).not.toContain('Responding…');
  });
});
