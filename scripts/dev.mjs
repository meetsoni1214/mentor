import { spawn } from 'node:child_process';

if (!process.env.PORTLESS_URL || !process.env.PORT) {
  throw new Error('Start development with pnpm dev to configure Portless.');
}

// The API must allow the browser's public origin, including worktree prefixes.
// Exported values take precedence over the existing .env in every child process.
const child = spawn('pnpm', ['dev:direct'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    APP_ORIGIN: new URL(process.env.PORTLESS_URL).origin,
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.once('error', () => {
  console.error(
    'Could not start development services. Check pnpm is installed.',
  );
  process.exitCode = 1;
});

child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
