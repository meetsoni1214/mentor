import { describe, expect, it } from 'vitest';
import { normalizeWebEvidence } from '../../packages/backend/src/conversation/adapters/openai-conversation.evidence.js';

const answer = 'A supported claim.';
const annotation = {
  type: 'url_citation',
  title: 'Release notes',
  url: 'https://example.test/releases',
  start_index: 2,
  end_index: answer.length,
};
const call = {
  type: 'hosted_tool_call',
  name: 'web_search_call',
  id: 'ws_1',
  status: 'completed',
  providerData: {
    type: 'web_search_call',
    action: { type: 'search', query: 'PRIVATE query' },
  },
};
function message(text = answer, annotations: unknown = [annotation]) {
  return {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text, providerData: { annotations } }],
  };
}
const normalize = (annotations: unknown = [annotation]) =>
  normalizeWebEvidence(
    [{ output: [call, message(answer, annotations)] }],
    answer,
    true,
  );

describe('observed SDK web evidence', () => {
  it('records only source metadata and observed terminal activity', () => {
    const result = normalize();
    expect(result).toEqual({
      sources: [
        {
          title: 'Release notes',
          url: annotation.url,
          startIndex: 2,
          endIndex: answer.length,
        },
      ],
      activity: [{ type: 'web_search', status: 'completed' }],
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,example',
    'file:///etc/passwd',
    'https://owner:secret@example.test',
    'https://example.test/\nunsafe',
    'https:\\example.test',
    'not a URL',
    'https://example.test/' + 'x'.repeat(2048),
  ])('rejects unsafe source URL %s', (url) => {
    expect(normalize([{ ...annotation, url }]).sources).toEqual([]);
  });

  it.each([
    null,
    {},
    'an invented source',
    { ...annotation, type: 'file_citation' },
    { ...annotation, title: '' },
    { ...annotation, title: 'x'.repeat(501) },
    { ...annotation, start_index: -1 },
    { ...annotation, start_index: 1.5 },
    { ...annotation, end_index: answer.length + 1 },
    { ...annotation, end_index: 1 },
  ])('ignores malformed annotations without losing an answer: %j', (value) => {
    expect(normalize([value]).sources).toEqual([]);
  });

  it('ignores unknown annotation containers and deduplicates overlapping citations', () => {
    expect(normalize({ annotations: [annotation] }).sources).toEqual([]);
    expect(
      normalize([annotation, annotation, { ...annotation, start_index: 3 }])
        .sources,
    ).toHaveLength(1);
  });

  it('retains multiple sources attached to one citation marker', () => {
    const result = normalize([
      annotation,
      { ...annotation, url: 'https://other.test/release' },
    ]);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((source) => source.url)).toEqual([
      annotation.url,
      'https://other.test/release',
    ]);
  });

  it('never promotes fabricated prose, unknown output, or an unavailable tool into evidence', () => {
    const raw = [
      {
        output: [
          null,
          {},
          { type: 'invented_search', status: 'completed' },
          message(),
        ],
      },
    ];
    expect(normalizeWebEvidence(raw, answer, true)).toEqual({
      sources: [],
      activity: [],
    });
    expect(
      normalizeWebEvidence([{ output: [call, message()] }], answer, false),
    ).toEqual({ sources: [], activity: [] });
    expect(
      normalizeWebEvidence(
        [{ output: [call, message('Different text')] }],
        answer,
        true,
      ).sources,
    ).toEqual([]);
  });

  it('records failed searches honestly without promoting citations', () => {
    expect(
      normalizeWebEvidence(
        [{ output: [{ ...call, status: 'failed' }, message()] }],
        answer,
        true,
      ),
    ).toEqual({
      sources: [],
      activity: [{ type: 'web_search', status: 'failed' }],
    });
    expect(
      normalizeWebEvidence(
        [{ output: [{ ...call, status: 'searching' }, message()] }],
        answer,
        true,
      ),
    ).toEqual({ sources: [], activity: [] });
  });

  it('uses only final-answer annotations while retaining search activity from earlier steps', () => {
    const final = 'A later supported claim.';
    const result = normalizeWebEvidence(
      [
        { output: [call, message()] },
        {
          output: [
            message(final, [
              { ...annotation, start_index: 0, end_index: final.length },
            ]),
          ],
        },
      ],
      final,
      true,
    );
    expect(result.sources).toEqual([
      {
        title: annotation.title,
        url: annotation.url,
        startIndex: 0,
        endIndex: final.length,
      },
    ]);
    expect(result.activity).toHaveLength(1);
  });

  it('aligns citation positions across final text parts and segmented assistant messages', () => {
    const prefix = '🌱 First part. ';
    const result = normalizeWebEvidence(
      [{ output: [call, message(prefix, []), message()] }],
      prefix + answer,
      true,
    );
    expect(result.sources[0]).toMatchObject({
      startIndex: prefix.length + 2,
      endIndex: prefix.length + answer.length,
    });
  });

  it('rejects a citation range splitting a Unicode surrogate pair', () => {
    const text = '🌱 A claim.';
    expect(
      normalizeWebEvidence(
        [
          {
            output: [
              call,
              message(text, [
                { ...annotation, start_index: 1, end_index: text.length },
              ]),
            ],
          },
        ],
        text,
        true,
      ).sources,
    ).toEqual([]);
  });

  it.each(['code units', 'Unicode characters'])(
    'normalizes marker positions after emoji from %s',
    (encoding) => {
      const marker = '\uE200cite\uE202turn0search0\uE201';
      const prefix = '🌱 A claim. ';
      const text = prefix + marker;
      const start =
        encoding === 'code units' ? prefix.length : [...prefix].length;
      const result = normalizeWebEvidence(
        [
          {
            output: [
              call,
              message(text, [
                {
                  ...annotation,
                  start_index: start,
                  end_index: start + marker.length,
                },
              ]),
            ],
          },
        ],
        text,
        true,
      );
      expect(result.sources[0]).toMatchObject({
        startIndex: prefix.length,
        endIndex: text.length,
      });
    },
  );

  it('bounds persisted evidence without treating the record limit as an execution budget', () => {
    const text = 'x'.repeat(30);
    const result = normalizeWebEvidence(
      [
        {
          output: [
            ...Array.from({ length: 30 }, (_, index) => ({
              ...call,
              id: `ws_${index}`,
            })),
            message(
              text,
              Array.from({ length: 30 }, (_, index) => ({
                ...annotation,
                start_index: index,
                end_index: index + 1,
                url: `https://example.test/${index}`,
              })),
            ),
          ],
        },
      ],
      text,
      true,
    );
    expect(result.activity).toHaveLength(20);
    expect(result.sources).toHaveLength(20);
  });
});
