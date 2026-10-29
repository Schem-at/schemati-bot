import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { onReady } from './events/ready.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { isRedisReady, startRedisSubscriber } from './events/redis.js';
import { flushSoon, record, startTelemetry } from './telemetry.js';
import { checkDatabaseConnection } from './db/index.js';

// Never let an async failure disappear without a trace.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception:', err);
  // Exit so the platform restarts a wedged process instead of leaving a zombie running.
  process.exit(1);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('clientReady', (readyClient) => {
  onReady(readyClient);
  startRedisSubscriber(readyClient);
  startTelemetry(readyClient, isRedisReady);
});
client.on('interactionCreate', onInteractionCreate);
client.on('guildCreate', (guild) => {
  console.log(`[guilds] joined ${guild.name} (${guild.id}), ${guild.memberCount} members`);
  record({ kind: 'guild', name: 'guild.joined', status: 'ok', guild_id: guild.id, message: guild.name });
  flushSoon();
});
client.on('guildDelete', (guild) => {
  // `available === false` is a Discord outage, not a removal; the next snapshot will tell.
  if (!guild.available) return;
  console.log(`[guilds] removed from ${guild.name} (${guild.id})`);
  record({ kind: 'guild', name: 'guild.left', status: 'ok', guild_id: guild.id, message: guild.name });
  flushSoon();
});

/**
 * Block startup until Postgres answers. The bot is useless without it (every command queries
 * the database), so a broken Postgres should be a loud, restarting failure, not a silent one.
 */
async function waitForDatabase(maxAttempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await checkDatabaseConnection();
      console.log('[db] connected');
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const delay = Math.min(attempt * 1000, 15_000);
      console.error(`[db] not reachable (attempt ${attempt}/${maxAttempts}): ${message}`);
      if (attempt === maxAttempts) {
        console.error('[fatal] could not reach PostgreSQL after multiple attempts; exiting so the platform restarts');
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();

  try {
    await client.login(config.discord.token);
  } catch (err) {
    console.error('[fatal] Discord login failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
