import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
import type { Command } from './index.js';
import { resolvePlayer } from '../db/resolve-player.js';
import { db } from '../db/index.js';
import {
  communities,
  communityPlayers,
  discordChannelMappings,
} from '../db/schema.js';
import { populateForumChannels } from '../services/channel-sync.js';

export const populateForums: Command = {
  data: new SlashCommandBuilder()
    .setName('populate-forums')
    .setDescription('Create forum threads for all existing schematics in mapped channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild ?? interaction.client.guilds.cache.get(interaction.guildId);
    if (!guild) {
      await interaction.reply({
        content: 'Could not resolve this server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Verify caller is a community admin
    const player = await resolvePlayer(interaction.user.id);
    if (!player) {
      await interaction.reply({
        content: 'Your Discord account is not linked to a schemat.io account.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Find the community linked to this guild
    const community = await db
      .select()
      .from(communities)
      .where(eq(communities.discordGuildId, guild.id))
      .limit(1);

    if (community.length === 0) {
      await interaction.reply({
        content: 'This server is not linked to a schemat.io community. Run `/setup` first.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const comm = community[0];

    // Check the user is an admin of this community
    const membership = await db
      .select()
      .from(communityPlayers)
      .where(
        and(
          eq(communityPlayers.communityId, comm.id),
          eq(communityPlayers.playerId, player.playerId),
          eq(communityPlayers.role, 'admin'),
          eq(communityPlayers.isActive, true),
        ),
      )
      .limit(1);

    if (membership.length === 0) {
      await interaction.reply({
        content: 'You must be a community admin to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Find active forum channel mappings for this community
    const mappings = await db
      .select()
      .from(discordChannelMappings)
      .where(
        and(
          eq(discordChannelMappings.communityId, comm.id),
          eq(discordChannelMappings.channelType, 'forum'),
          eq(discordChannelMappings.status, 'active'),
        ),
      );

    if (mappings.length === 0) {
      await interaction.editReply({
        content: 'No active forum channel mappings found. Configure tag-to-channel mappings in your community Discord settings first.',
      });
      return;
    }

    const mappingIds = mappings.map((m) => m.id);
    const { created, skipped, failed } = await populateForumChannels(guild, mappingIds);

    const parts = [`Created **${created}** forum thread(s).`];
    if (skipped > 0) parts.push(`Skipped ${skipped} (already had threads).`);
    if (failed > 0) parts.push(`Failed: ${failed}.`);

    await interaction.editReply({ content: parts.join(' ') });
  },
};
