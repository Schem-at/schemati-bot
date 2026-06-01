import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { commands } from './index.js';

/**
 * Register all slash commands with Discord. In dev mode (with a dev guild) it registers
 * to that guild for instant updates; otherwise it registers globally. This runs on every
 * startup so a freshly deployed bot always has its commands in sync.
 */
export async function deployCommands(): Promise<void> {
  const rest = new REST().setToken(config.discord.token);
  const commandData = commands.map((command) => command.data.toJSON());

  const useDevGuild = config.devMode && config.discord.devGuildId;
  const route = useDevGuild
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId)
    : Routes.applicationCommands(config.discord.clientId);
  const target = useDevGuild ? `dev guild ${config.discord.devGuildId}` : 'globally';

  console.log(`[commands] deploying ${commandData.length} slash commands ${target}...`);
  await rest.put(route, { body: commandData });
  console.log(`[commands] deployed ${commandData.length} slash commands ${target}`);
}
