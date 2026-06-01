import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './index.js';

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is online'),

  async execute(interaction: ChatInputCommandInteraction) {
    const latency = Date.now() - interaction.createdTimestamp;
    await interaction.reply(`Pong! (${latency}ms)`);
  },
};
