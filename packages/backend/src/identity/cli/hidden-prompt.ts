import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export class PromptCancelledError extends Error {
  constructor() {
    super('Owner setup cancelled.');
  }
}

export async function readOwnerCredentials() {
  return readCredentials(false);
}

export async function readResetCredentials() {
  return readCredentials(true);
}

async function readCredentials(reset: boolean) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  // Suppress all readline output, including pasted input and password redraws.
  // Labels are printed separately. Neither credentials nor history are echoed.
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const readline = createInterface({
    input: process.stdin,
    output,
    terminal: true,
    historySize: 0,
  });
  readline.on('SIGINT', cancel);
  readline.on('close', cancel);
  process.once('SIGTERM', cancel);
  process.once('SIGHUP', cancel);

  async function ask(label: string): Promise<string> {
    process.stdout.write(label);
    try {
      return await readline.question('', { signal: controller.signal });
    } finally {
      process.stdout.write('\n');
    }
  }

  try {
    const email = await ask('Email (input hidden): ');
    if (reset) {
      process.stdout.write(
        'This replaces the password and signs out all sessions.\n',
      );
    }
    const password = await ask('Password (9–128 characters, input hidden): ');
    const confirmation = await ask('Confirm password (input hidden): ');
    return { email, password, confirmation };
  } catch {
    throw new PromptCancelledError();
  } finally {
    readline.close();
    output.destroy();
    process.off('SIGTERM', cancel);
    process.off('SIGHUP', cancel);
  }
}
