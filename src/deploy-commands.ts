import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands/index.js';

const rest = new REST().setToken(config.discord.token);

const commandData = commands.map((command) => command.data.toJSON());

const route = config.devMode && config.discord.devGuildId
  ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId)
  : Routes.applicationCommands(config.discord.clientId);

const target = config.devMode ? `dev guild ${config.discord.devGuildId}` : 'globally';
console.log(`Deploying ${commandData.length} slash commands ${target}...`);

try {
  await rest.put(route, { body: commandData });
  console.log(`Successfully deployed slash commands ${target}.`);
} catch (error) {
  console.error('Failed to deploy commands:', error);
  process.exit(1);
}
