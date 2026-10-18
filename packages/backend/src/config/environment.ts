import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

const databaseSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) =>
        value.startsWith('postgres://') || value.startsWith('postgresql://'),
    ),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(3000),
});

const serviceSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: port.default(3001),
  WORKER_PORT: port.default(3002),
});

function parseEnvironment<T>(
  schema: z.ZodType<T>,
  values: NodeJS.ProcessEnv,
): T {
  const result = schema.safeParse(values);
  if (!result.success) {
    // Never include environment values: URLs can contain database passwords.
    const keys = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(`Invalid environment configuration: ${keys.join(', ')}`);
  }
  return result.data;
}

export function readDatabaseEnvironment(
  values: NodeJS.ProcessEnv = process.env,
) {
  return parseEnvironment(databaseSchema, values);
}

export function readServiceEnvironment(
  values: NodeJS.ProcessEnv = process.env,
) {
  return parseEnvironment(serviceSchema, values);
}

export type DatabaseEnvironment = ReturnType<typeof readDatabaseEnvironment>;

const authSchema = z
  .object({
    APP_ORIGIN: z.url().default('http://127.0.0.1:3000'),
    SESSION_IDLE_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(1800),
    SESSION_ABSOLUTE_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(86_400),
  })
  .refine(
    (value) => value.SESSION_IDLE_SECONDS <= value.SESSION_ABSOLUTE_SECONDS,
    { path: ['SESSION_IDLE_SECONDS'] },
  );

export function readAuthEnvironment(values: NodeJS.ProcessEnv = process.env) {
  const result = parseEnvironment(authSchema, values);
  const origin = new URL(result.APP_ORIGIN);
  const production = values.NODE_ENV === 'production';
  const localHttp =
    origin.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (
    origin.origin !== result.APP_ORIGIN ||
    (origin.protocol !== 'https:' && (!localHttp || production)) ||
    (production && !values.APP_ORIGIN)
  ) {
    throw new Error('Invalid environment configuration: APP_ORIGIN');
  }
  return { ...result, secureCookies: origin.protocol === 'https:' };
}
