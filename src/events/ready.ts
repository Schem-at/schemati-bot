import type { Client } from 'discord.js';
import { deployCommands } from '../commands/deploy.js';

export async function onReady(client: Client<true>): Promise<void> {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guilds`);

  // Register slash commands on every startup so a deployed bot always has them in sync.
  // Production only runs the bot process (not the deploy-commands script), so without this
  // the commands would never appear.
  try {
    await deployCommands();
  } catch (err) {
    console.error('[commands] failed to deploy slash commands:', err instanceof Error ? err.message : err);
  }
}
