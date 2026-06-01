import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
import type { Command } from './index.js';
import { resolvePlayer } from '../db/resolve-player.js';
import { db } from '../db/index.js';
import { communities, communityPlayers } from '../db/schema.js';

export const setup: Command = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Link this Discord server to a Schemati community')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const guild = interaction.guild ?? interaction.client.guilds.cache.get(interaction.guildId);
    if (!guild) {
      await interaction.reply({ content: 'Could not resolve this server. Please re-invite the bot with the correct permissions.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Check if this guild is already linked
    const existing = await db
      .select({ id: communities.id, name: communities.name })
      .from(communities)
      .where(eq(communities.discordGuildId, guild.id))
      .limit(1);

    if (existing.length > 0) {
      await interaction.reply({
        content: `This server is already linked to **${existing[0].name}**. Use \`/cleanup\` first to unlink.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Resolve the Discord user to a Schemati player
    const player = await resolvePlayer(interaction.user.id);
    if (!player) {
      await interaction.reply({
        content: 'Your Discord account is not linked to a Schemati account. Link it first on schemat.io.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Find communities where this player is an admin
    const adminCommunities = await db
      .select({ id: communities.id, name: communities.name, slug: communities.slug })
      .from(communityPlayers)
      .innerJoin(communities, eq(communityPlayers.communityId, communities.id))
      .where(
        and(
          eq(communityPlayers.playerId, player.playerId),
          eq(communityPlayers.role, 'admin'),
          eq(communityPlayers.isActive, true),
        ),
      );

    if (adminCommunities.length === 0) {
      await interaction.reply({
        content: 'You are not an admin of any Schemati community.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Filter out communities that are already linked to another guild
    const unlinked = [];
    for (const c of adminCommunities) {
      const linked = await db
        .select({ discordGuildId: communities.discordGuildId })
        .from(communities)
        .where(eq(communities.id, c.id))
        .limit(1);

      if (!linked[0]?.discordGuildId) {
        unlinked.push(c);
      }
    }

    if (unlinked.length === 0) {
      await interaction.reply({
        content: 'All your communities are already linked to Discord servers.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let selectedCommunity: typeof unlinked[0];

    if (unlinked.length === 1) {
      selectedCommunity = unlinked[0];
    } else {
      // Show select menu for multiple communities
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('setup_community_select')
        .setPlaceholder('Select a community to link')
        .addOptions(unlinked.map((c) => ({ label: c.name, value: c.id })));

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      const response = await interaction.reply({
        content: 'Which community should this server be linked to?',
        components: [row],
        flags: MessageFlags.Ephemeral,
      });

      try {
        const selection = await response.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          time: 30_000,
        });

        const chosen = unlinked.find((c) => c.id === selection.values[0]);
        if (!chosen) {
          await selection.update({ content: 'Invalid selection.', components: [] });
          return;
        }
        selectedCommunity = chosen;
        await selection.update({ content: `Linking **${chosen.name}**...`, components: [] });
      } catch {
        await interaction.editReply({ content: 'Selection timed out.', components: [] });
        return;
      }
    }

    if (!selectedCommunity) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
      // Create the schemat.io category
      const category = await guild.channels.create({
        name: 'schemat.io',
        type: ChannelType.GuildCategory,
      });

      // Update community with guild ID and category ID
      await db
        .update(communities)
        .set({
          discordGuildId: guild.id,
          discordCategoryId: category.id,
        })
        .where(eq(communities.id, selectedCommunity.id));

      await interaction.editReply({
        content: `Linked this server to **${selectedCommunity.name}**!\n\nCreated the **${category.name}** category. Go to your community's Discord settings on schemat.io to configure tag-to-channel sync.`,
      });
    } catch (error) {
      console.error('Setup failed:', error);
      await interaction.editReply({
        content: 'Failed to set up. Make sure I have the **Manage Channels** permission.',
      });
    }
  },
};
