import {
  Collection,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { ping } from './ping.js';
import { whoami } from './whoami.js';
import { setup } from './setup.js';
import { cleanup } from './cleanup.js';
import { populateForums } from './populate-forums.js';
import { upload } from './upload.js';

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands = new Collection<string, Command>();

const commandList: Command[] = [ping, whoami, setup, cleanup, populateForums, upload];

for (const command of commandList) {
  commands.set(command.data.name, command);
}
