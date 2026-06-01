import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/** Match Laravel's Str::slug(APP_NAME, '_') so the Redis key prefix lines up automatically. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Build a PostgreSQL connection string. Prefers DATABASE_URL, but also accepts the
 * discrete Laravel-style DB_* variables so the bot can reuse the same env as the app.
 */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.DB_HOST;
  if (!host) {
    throw new Error(
      'Set DATABASE_URL, or the discrete DB_HOST / DB_PORT / DB_DATABASE / DB_USERNAME / DB_PASSWORD variables.',
    );
  }

  const port = process.env.DB_PORT ?? '5432';
  const name = required('DB_DATABASE');
  const user = required('DB_USERNAME');
  const pass = process.env.DB_PASSWORD ?? '';
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`;
  const sslmode = process.env.DB_SSLMODE ? `?sslmode=${process.env.DB_SSLMODE}` : '';

  return `postgresql://${auth}@${host}:${port}/${name}${sslmode}`;
}

/**
 * Build a Redis connection string. Prefers REDIS_URL, but also accepts the discrete
 * Laravel-style REDIS_HOST / REDIS_PORT / REDIS_PASSWORD variables.
 */
function redisUrl(): string {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  const host = process.env.REDIS_HOST;
  if (!host) {
    return 'redis://localhost:6379';
  }

  const port = process.env.REDIS_PORT ?? '6379';
  // Laravel passes the literal string "null" when there is no Redis password; treat that
  // (and empty) as no auth instead of trying to authenticate with the word "null".
  const password = process.env.REDIS_PASSWORD;
  const hasPassword = password && password.toLowerCase() !== 'null';
  const auth = hasPassword ? `:${encodeURIComponent(password)}@` : '';

  return `redis://${auth}${host}:${port}`;
}

const appName = process.env.APP_NAME ?? 'laravel';

export const config = {
  devMode: process.env.DEV_MODE === 'true',
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    devGuildId: process.env.DISCORD_DEV_GUILD_ID ?? '',
  },
  database: {
    url: databaseUrl(),
  },
  api: {
    // Used both for server-to-server calls and for building user-facing links in Discord,
    // so it must be the public app URL. Falls back to APP_URL when API_BASE_URL is unset.
    baseUrl: process.env.API_BASE_URL ?? process.env.APP_URL ?? required('API_BASE_URL'),
    token: process.env.API_TOKEN ?? '',
  },
  storage: {
    baseUrl: process.env.STORAGE_BASE_URL ?? process.env.AWS_URL ?? 'http://localhost:9000',
  },
  redis: {
    url: redisUrl(),
    // Mirrors Laravel's default: slug(APP_NAME)_database_. Override with REDIS_PREFIX if needed.
    prefix: process.env.REDIS_PREFIX ?? `${slug(appName)}_database_`,
  },
  botSecret: process.env.BOT_SECRET ?? '',
} as const;
