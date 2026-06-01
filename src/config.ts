import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  devMode: process.env.DEV_MODE === 'true',
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    devGuildId: process.env.DISCORD_DEV_GUILD_ID ?? '',
  },
  database: {
    url: required('DATABASE_URL'),
  },
  api: {
    baseUrl: required('API_BASE_URL'),
    token: process.env.API_TOKEN ?? '',
  },
  storage: {
    baseUrl: process.env.STORAGE_BASE_URL ?? 'http://localhost:9000',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    prefix: process.env.REDIS_PREFIX ?? 'schemati_database_',
  },
  botSecret: process.env.BOT_SECRET ?? '',
} as const;
