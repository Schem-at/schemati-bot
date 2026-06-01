import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Command } from './index.js';
import { resolvePlayer } from '../db/resolve-player.js';
import { config } from '../config.js';

export const whoami: Command = {
  data: new SlashCommandBuilder()
    .setName('whoami')
    .setDescription('Check your linked Schemati account'),

  async execute(interaction: ChatInputCommandInteraction) {
    const player = await resolvePlayer(interaction.user.id);

    if (!player) {
      const linkButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Link your account')
          .setStyle(ButtonStyle.Link)
          .setURL(`${config.api.baseUrl}/auth/discord/link`),
      );

      await interaction.reply({
        content: 'Your Discord account is not linked to a Schemati account.',
        components: [linkButton],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `You are linked as **${player.playerName ?? 'Unknown'}**`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
