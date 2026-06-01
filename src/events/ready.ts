import type { Client } from 'discord.js';

export function onReady(client: Client<true>): void {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Serving ${client.guilds.cache.size} guilds`);
}
