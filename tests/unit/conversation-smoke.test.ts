import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// A fresh process exercises the actual CLI opt-in and SDK path. Its preloaded
// fetch denies every real request, including telemetry and accidental retries.
function run(
  args: string[],
  configured = true,
  fail = false,
  evidence = true,
  slow = false,
) {
  const preload = `
    let calls = 0, unexpected = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url) !== 'https://api.openai.com/v1/responses') { unexpected++; throw new Error('Unexpected outbound request'); }
      const request = JSON.parse(init.body);
      calls++;
      if (request.store !== false || request.max_output_tokens !== 512 || request.max_tool_calls !== 1 || request.model !== 'synthetic-smoke-model') throw new Error('Wrong controls');
      if (request.previous_response_id || request.conversation) throw new Error('Provider state used');
      if (calls === 2 && !JSON.stringify(request.input).includes('cobalt-17')) throw new Error('Missing context');
      if (${slow}) return new Promise((_, reject) => {
        if (init.signal.aborted) reject(new Error('Synthetic deadline'));
        else init.signal.addEventListener('abort', () => reject(new Error('Synthetic deadline')), {once:true});
      });
      if (${fail}) return new Response(JSON.stringify({error:{message:'private-provider-detail'}}), {status:503, headers:{'Content-Type':'application/json'}});
      if (calls > 3) throw new Error('Unexpected replay');
      const text = calls === 2 ? 'cobalt-17' : calls === 3 ? 'The official handbook. [1]' : 'Acknowledged.';
      const output = [{id:'msg', type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:calls === 3 ? [{type:'url_citation',url:'https://www.typescriptlang.org/docs/handbook/',title:'TypeScript Handbook',start_index:23,end_index:26}] : []}]}];
      if(calls === 3 && ${evidence}) output.unshift({id:'ws',type:'web_search_call',status:'completed',action:{type:'search',query:'TypeScript handbook'}});
      return new Response(JSON.stringify({id:'resp',object:'response',status:'completed',model:'synthetic-smoke-model',output,usage:{input_tokens:10,output_tokens:5,total_tokens:15}}), {headers:{'Content-Type':'application/json'}});
    };
    process.on('exit', () => { console.error('synthetic-calls=' + calls); if(unexpected) process.exitCode = 1; });
  `;
  return spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      'scripts/conversation-smoke.mjs',
      ...args,
    ],
    {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        OPENAI_API_KEY: configured ? 'synthetic-smoke-key' : '',
        OPENAI_CHAT_MODEL: 'synthetic-smoke-model',
        AI_MAX_OUTPUT_TOKENS: '2048',
        AI_DEADLINE_MS: slow ? '100' : '60000',
        AI_MAX_MESSAGE_BYTES: '8192',
        AI_MAX_CONTEXT_BYTES: '32768',
        AI_MAX_TOOL_CALLS: '2',
      },
    },
  );
}

describe('opt-in conversation smoke CLI with outbound traffic intercepted', () => {
  it('requires explicit live opt-in even with valid configuration', () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires --live');
    expect(result.stderr).toContain('synthetic-calls=0');
  });

  it('makes no request when configuration is missing', () => {
    const result = run(['--live'], false);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('configuration is required');
    expect(result.stderr).toContain('synthetic-calls=0');
  });

  it('carries synthetic context and requires observed search evidence', () => {
    const result = run(['--live']);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      passed: true,
      contextualRecall: true,
      observedSearchWithSources: true,
      limits: {
        model: 'synthetic-smoke-model',
        maxOutputTokens: 512,
        maxToolCalls: 1,
        deadlineMs: 30_000,
      },
    });
    expect(result.stderr).toContain('synthetic-calls=3');
    expect(result.stdout + result.stderr).not.toContain('synthetic-smoke-key');
  });

  it('stops after provider failure without exposing or retrying the error', () => {
    const result = run(['--live'], true, true);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      passed: false,
      results: [{ state: 'failed', errorCode: 'PROVIDER_ERROR' }],
    });
    expect(result.stderr).toContain('synthetic-calls=1');
    expect(result.stdout + result.stderr).not.toContain(
      'private-provider-detail',
    );
  });
  it('does not count an unobserved citation as live search evidence', () => {
    const result = run(['--live'], true, false, false);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      passed: false,
      contextualRecall: true,
      observedSearchWithSources: false,
    });
    expect(result.stderr).toContain('synthetic-calls=3');
  });

  it('aborts a slow request at the configured deadline without another step', () => {
    const result = run(['--live'], true, false, true, true);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      passed: false,
      results: [{ state: 'interrupted', errorCode: 'INTERRUPTED' }],
    });
    expect(result.stderr).toContain('synthetic-calls=1');
  });
});
