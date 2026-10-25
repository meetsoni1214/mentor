import { describe, expect, it } from 'vitest';
import { selectContext } from '../../packages/backend/src/conversation/application/select-context.js';
import type { ModelMessage } from '../../packages/backend/src/conversation/application/conversation.contracts.js';

const current = {
  role: 'user',
  text: 'Current question',
} satisfies ModelMessage;

describe('conversation context selection', () => {
  it('retains the current message when there is no completed history', () => {
    expect(selectContext(current.text, [], 1024)).toEqual({
      messages: [current],
      contextLimited: false,
    });
  });

  it('orders newest-first pairs chronologically without changing input or text', () => {
    const history = Object.freeze([
      Object.freeze({ text: ' Recent question\n', answer: ' Recent answer ' }),
      Object.freeze({ text: 'Older question', answer: 'Older answer' }),
    ]);
    expect(selectContext(current.text, history, 1024)).toEqual({
      messages: [
        { role: 'user', text: 'Older question' },
        { role: 'assistant', text: 'Older answer' },
        { role: 'user', text: ' Recent question\n' },
        { role: 'assistant', text: ' Recent answer ' },
        current,
      ],
      contextLimited: false,
    });
  });

  it.each(['plain text', '🌱 café 你好', '"quoted"\n\\path\t'])(
    'uses serialized UTF-8 bytes at the exact limit for %j',
    (text) => {
      const history = [{ text, answer: 'An answer' }];
      const messages: ModelMessage[] = [
        { role: 'user', text },
        { role: 'assistant', text: 'An answer' },
        current,
      ];
      const exactBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
      expect(selectContext(current.text, history, exactBytes)).toEqual({
        messages,
        contextLimited: false,
      });
      expect(selectContext(current.text, history, exactBytes - 1)).toEqual({
        messages: [current],
        contextLimited: true,
      });
    },
  );

  it('keeps whole pairs and stops instead of skipping a pair that cannot fit', () => {
    const recent = { text: 'Recent question', answer: 'Recent answer' };
    const messages: ModelMessage[] = [
      { role: 'user', text: recent.text },
      { role: 'assistant', text: recent.answer },
      current,
    ];
    const history = [
      recent,
      { text: 'Large question'.repeat(100), answer: 'Large answer' },
      { text: 'Old', answer: 'Small' },
    ];
    expect(selectContext(current.text, history, 300)).toEqual({
      messages,
      contextLimited: true,
    });
  });

  it('does not include a user message when its matching answer cannot fit', () => {
    expect(
      selectContext(
        current.text,
        [{ text: 'Q', answer: 'A'.repeat(500) }],
        200,
      ),
    ).toEqual({ messages: [current], contextLimited: true });
  });

  it('retains the current message when it alone exhausts the context budget', () => {
    const exactBytes = Buffer.byteLength(JSON.stringify([current]), 'utf8');
    expect(
      selectContext(current.text, [{ text: 'Q', answer: 'A' }], exactBytes),
    ).toEqual({ messages: [current], contextLimited: true });
  });

  it.each([99, 100, 101])(
    'selects at most 100 of %i completed pairs',
    (count) => {
      const history = Array.from({ length: count }, (_, index) => ({
        text: `Question ${count - index}`,
        answer: `Answer ${count - index}`,
      }));
      const selected = selectContext(current.text, history, 100_000);
      const kept = Math.min(count, 100);
      expect(selected.messages).toHaveLength(kept * 2 + 1);
      expect(selected.messages.slice(0, 2)).toEqual([
        { role: 'user', text: `Question ${count - kept + 1}` },
        { role: 'assistant', text: `Answer ${count - kept + 1}` },
      ]);
      expect(selected.messages.slice(-3)).toEqual([
        { role: 'user', text: `Question ${count}` },
        { role: 'assistant', text: `Answer ${count}` },
        current,
      ]);
      expect(selected.contextLimited).toBe(count > 100);
    },
  );
});
