import { Buffer } from 'node:buffer';

// Separate from every ordinary verification command. Never reads the database.
if (process.argv.slice(2).join(' ') !== '--live') {
  console.error(
    'Live smoke requires --live and can incur OpenAI charges. See docs/conversation-loop.md.',
  );
  process.exitCode = 1;
} else {
  try {
    const { readAIEnvironment } = await import('@mentor/backend/config/ai');
    const configuration = readAIEnvironment();
    if (!configuration.enabled) {
      console.error(
        'Live smoke unavailable: valid server AI configuration is required.',
      );
      process.exitCode = 1;
    } else {
      const { OpenAIConversationModel } =
        await import('@mentor/backend/conversation/model');
      const model = new OpenAIConversationModel(configuration.apiKey);
      const limits = {
        model: configuration.limits.model,
        maxOutputTokens: Math.min(configuration.limits.maxOutputTokens, 512),
        maxToolCalls: 1,
        deadlineMs: Math.min(configuration.limits.deadlineMs, 30_000),
      };
      const questions = [
        'Synthetic smoke exercise: our fictional project code is cobalt-17. Acknowledge it briefly.',
        'What is the fictional project code I just gave you? Answer briefly using our conversation.',
        'Use public web search to find the official TypeScript handbook. Cite its official source and briefly explain its purpose. Do not access any private account or perform actions.',
      ];
      const messages = [];
      const results = [];
      for (const [index, text] of questions.entries()) {
        messages.push({ role: 'user', text });
        if (
          Buffer.byteLength(text) > configuration.limits.maxMessageBytes ||
          Buffer.byteLength(JSON.stringify(messages)) >
            configuration.limits.maxContextBytes
        ) {
          results.push({
            step: index + 1,
            state: 'unavailable',
            reason: 'Synthetic input exceeds configured input limits',
          });
          break;
        }
        const outcome = await model.complete({
          ...limits,
          messages: [...messages],
          tools: ['web_search'],
          signal: globalThis.AbortSignal.timeout(limits.deadlineMs),
        });
        results.push({ step: index + 1, ...outcome });
        if (outcome.state !== 'completed') break;
        messages.push({ role: 'assistant', text: outcome.answer });
      }
      const contextualRecall =
        results[1]?.state === 'completed' &&
        /cobalt-17/i.test(results[1].answer);
      const investigation = results[2];
      const observedSearchWithSources =
        investigation?.state === 'completed' &&
        investigation.activity.some(
          (item) => item.type === 'web_search' && item.status === 'completed',
        ) &&
        investigation.sources.length > 0;
      const passed =
        results.length === 3 &&
        results.every((item) => item.state === 'completed') &&
        contextualRecall &&
        observedSearchWithSources;
      console.log(
        JSON.stringify(
          {
            kind: 'live-provider-smoke',
            time: new Date().toISOString(),
            limits,
            contextualRecall,
            observedSearchWithSources,
            passed,
            results,
          },
          null,
          2,
        ),
      );
      if (!passed) process.exitCode = 1;
    }
  } catch {
    // Provider exceptions and environment values must not reach CLI diagnostics.
    console.error(
      'Live smoke failed; no automatic retry. Check configuration and connectivity.',
    );
    process.exitCode = 1;
  }
}
