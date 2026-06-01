import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Command } from './index.js';
import { db } from '../db/index.js';
import { communities, discordChannelMappings } from '../db/schema.js';
import { deleteChannels, deleteCategory } from '../services/channel-sync.js';

export const cleanup: Command = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Unlink this server from Schemati and remove synced channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const guild = interaction.guild ?? interaction.client.guilds.cache.get(interaction.guildId);
    if (!guild) {
      await interaction.reply({ content: 'Could not resolve this server.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Find the community linked to this guild
    const linked = await db
      .select({
        id: communities.id,
        name: communities.name,
        discordCategoryId: communities.discordCategoryId,
      })
      .from(communities)
      .where(eq(communities.discordGuildId, guild.id))
      .limit(1);

    if (linked.length === 0) {
      await interaction.reply({ content: 'No Schemati community is linked to this server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const community = linked[0];

    // Get all channel mappings
    const mappings = await db
      .select({
        id: discordChannelMappings.id,
        discordChannelId: discordChannelMappings.discordChannelId,
      })
      .from(discordChannelMappings)
      .where(eq(discordChannelMappings.communityId, community.id));

    const channelCount = mappings.filter((m) => m.discordChannelId).length;
    const total = channelCount + (community.discordCategoryId ? 1 : 0);

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('cleanup_confirm')
        .setLabel(`Unlink & delete ${total} channels`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cleanup_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    const response = await interaction.reply({
      content: `This will unlink **${community.name}** and delete **${total}** synced channels from this server.\n\nAre you sure?`,
      components: [confirmRow],
      flags: MessageFlags.Ephemeral,
    });

    try {
      const button = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 30_000,
      });

      if (button.customId === 'cleanup_cancel') {
        await button.update({ content: 'Cleanup cancelled.', components: [] });
        return;
      }

      await button.update({ content: 'Cleaning up...', components: [] });

      // Delete mapped channels
      const deleteRequests = mappings
        .filter((m) => m.discordChannelId)
        .map((m) => ({ mappingId: m.id, channelId: m.discordChannelId! }));

      if (deleteRequests.length > 0) {
        await deleteChannels(guild, deleteRequests);
      }

      // Delete the category
      if (community.discordCategoryId) {
        await deleteCategory(guild, community.discordCategoryId);
      }

      // Clear community discord fields
      await db
        .update(communities)
        .set({
          discordGuildId: null,
          discordCategoryId: null,
        })
        .where(eq(communities.id, community.id));

      // Remove remaining mappings
      await db
        .delete(discordChannelMappings)
        .where(eq(discordChannelMappings.communityId, community.id));

      await interaction.editReply({ content: `Unlinked **${community.name}** and deleted **${total}** channels. Clean slate!` });
    } catch {
      await interaction.editReply({ content: 'Cleanup timed out. No changes were made.', components: [] });
    }
  },
};
