import { spawnSync } from 'node:child_process';

const project = `mentor-test-${process.pid}`;
const compose = ['compose', '-f', 'compose.test.yaml', '-p', project];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed${result.status === null ? '' : ` (${result.status})`}`,
    );
  }
  return result;
}

try {
  run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '60']);
  const result = run('docker', [...compose, 'port', 'postgres', '5432'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const match = /127\.0\.0\.1:(\d+)/.exec(result.stdout);
  if (!match?.[1])
    throw new Error('Could not discover the isolated database port');
  run(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
    {
      env: {
        ...process.env,
        TEST_DATABASE_URL: `postgresql://mentor_test:isolated_test_only@127.0.0.1:${match[1]}/mentor_test`,
      },
    },
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Integration checks failed',
  );
  process.exitCode = 1;
} finally {
  const cleanup = spawnSync('docker', [...compose, 'down', '--volumes'], {
    stdio: 'inherit',
  });
  if (cleanup.error || cleanup.status !== 0) process.exitCode = 1;
}
