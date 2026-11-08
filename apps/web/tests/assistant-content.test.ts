import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantContent } from '../src/features/conversation/ui/content/assistant-content';
import { ConversationMessage } from '../src/features/conversation/ui/conversation-message';
import { completed, running } from './fixtures/conversation-stream';
import type { AnswerSource } from '../src/features/conversation/ui/content/citation-markdown';

const render = (text: string) =>
  renderToStaticMarkup(createElement(AssistantContent, { text }));

describe('assistant content', () => {
  const marker = '\uE200cite\uE202turn0search0\uE201';
  const cited = `**Supported claim.** ${marker}`;
  const source = {
    title: 'Release notes',
    url: 'https://example.test/releases',
    startIndex: cited.indexOf(marker),
    endIndex: cited.length,
  };
  const renderSources = (text: string, sources: readonly AnswerSource[]) =>
    renderToStaticMarkup(createElement(AssistantContent, { text, sources }));

  it('renders provider citations inline and keeps recorded sources visible', () => {
    const html = renderSources(cited, [source]);
    expect(html).toContain('<strong>Supported claim.</strong>');
    expect(html).toContain('class="answer-citation"');
    expect(html).toContain('aria-label="Source 1: Release notes"');
    expect(html).toContain('href="https://example.test/releases"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="Response sources"');
    expect(html).not.toContain(marker);
  });

  it('keeps generated links inert even when their destination or marker matches a real source', () => {
    const prefix =
      '[Invented](https://example.test/releases) [Fake](#mentor-citation-1) ';
    const html = renderSources(prefix + cited, [
      {
        ...source,
        startIndex: prefix.length + source.startIndex,
        endIndex: prefix.length + source.endIndex,
      },
    ]);
    expect(html).toContain('<span>Invented</span>');
    expect(html).toContain('<span>Fake</span>');
    expect((html.match(/class="answer-citation"/g) ?? []).length).toBe(1);
  });

  it('renders several sources for one provider marker without duplicating the marker text', () => {
    const html = renderSources(cited, [
      source,
      { ...source, title: 'Another source', url: 'https://other.test/release' },
    ]);
    expect((html.match(/class="answer-citation"/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-label="Source 2: Another source"');
    expect(html).not.toContain(marker);
  });

  it('explains when a completed search has no usable recorded source', () => {
    const html = renderToStaticMarkup(
      createElement(ConversationMessage, {
        turn: {
          ...completed.turn,
          attempts: [
            {
              ...completed.attempt,
              activity: [{ type: 'web_search', status: 'completed' }],
            },
          ],
        },
        refreshing: false,
        onRefresh: () => {},
        provisional: null,
      }),
    );
    expect(html).toContain('No usable source references were recorded');
  });

  it('exposes recorded citation links only after committed completion', () => {
    const turn = {
      ...completed.turn,
      attempts: [{ ...completed.attempt, answer: cited, sources: [source] }],
    };
    const final = renderToStaticMarkup(
      createElement(ConversationMessage, {
        turn,
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
          historyVersion: 0,
          turnId: turn.id,
          attemptId: running.attempt.id,
          text: cited,
        },
      }),
    );
    expect(final).toContain('class="answer-citation"');
    expect(partial).not.toContain('href=');
    expect(partial).toContain('Responding…');
  });

  it('preserves cited prose and uses UTF-16 positions after emoji', () => {
    const text = '🌱 A supported claim.';
    const html = renderSources(text, [
      { ...source, startIndex: 3, endIndex: text.length },
    ]);
    expect(html).toContain('🌱 A supported claim. ');
    expect(html).toContain('class="answer-citation"');
  });

  it('does not turn citations inside a code block into navigable code', () => {
    const text = '```\n' + cited + '\n```';
    const html = renderSources(text, [
      {
        ...source,
        startIndex: 4 + source.startIndex,
        endIndex: 4 + source.endIndex,
      },
    ]);
    expect(html).toContain('<pre tabindex="0"><code>');
    expect(html).not.toContain('class="answer-citation"');
    expect(html).toContain('aria-label="Response sources"');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'https://user:secret@example.test',
    'not a URL',
  ])('never displays an unsafe source link: %s', (url) => {
    const html = renderSources(cited, [{ ...source, url }]);
    expect(html).not.toContain('href=');
    expect(html).not.toContain('answer-citation');
  });

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
