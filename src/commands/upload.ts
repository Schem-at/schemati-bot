import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Command } from './index.js';
import { resolvePlayer } from '../db/resolve-player.js';
import { db } from '../db/index.js';
import { communities } from '../db/schema.js';
import { config } from '../config.js';

const ALLOWED_EXTENSIONS = ['.schem', '.schematic', '.litematic', '.mcstructure'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const upload: Command = {
  data: new SlashCommandBuilder()
    .setName('upload')
    .setDescription('Upload a schematic to schemat.io')
    .addAttachmentOption((option) =>
      option
        .setName('file')
        .setDescription('The schematic file (.schem, .schematic, .litematic, .mcstructure)')
        .setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Look up the community linked to this guild
    const communityRows = await db
      .select({ id: communities.id, name: communities.name })
      .from(communities)
      .where(eq(communities.discordGuildId, interaction.guildId))
      .limit(1);

    if (communityRows.length === 0) {
      await interaction.reply({
        content: 'This server is not linked to a Schemati community. An admin needs to run `/setup` first.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const community = communityRows[0];

    // Resolve the Discord user to a Schemati player
    const player = await resolvePlayer(interaction.user.id);
    if (!player) {
      await interaction.reply({
        content: 'Your Discord account is not linked to a Schemati account. Link it first on schemat.io.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const attachment = interaction.options.getAttachment('file', true);

    // Validate file extension
    const fileName = attachment.name.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext));
    if (!hasValidExtension) {
      await interaction.reply({
        content: `Invalid file type. Accepted formats: ${ALLOWED_EXTENSIONS.join(', ')}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate file size
    if (attachment.size > MAX_FILE_SIZE) {
      await interaction.reply({
        content: 'File is too large. Maximum size is 10MB.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Download file from Discord CDN
      const fileResponse = await fetch(attachment.url);
      if (!fileResponse.ok) {
        await interaction.editReply({ content: 'Failed to download the attached file from Discord.' });
        return;
      }

      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());

      // Build multipart form data
      const formData = new FormData();
      formData.append('schematic', new Blob([fileBuffer]), attachment.name);
      formData.append('author_id', player.playerId);

      // POST to Laravel API
      const apiResponse = await fetch(`${config.api.baseUrl}/api/v1/bot/schematics/upload`, {
        method: 'POST',
        headers: {
          'X-Bot-Secret': config.botSecret,
          'X-Community-Id': community.id,
          Accept: 'application/json',
        },
        body: formData,
      });

      if (!apiResponse.ok) {
        const errorBody = await apiResponse.json().catch(() => ({}));
        const errorMessage = (errorBody as Record<string, string>).message ?? 'Upload failed.';
        await interaction.editReply({ content: `Upload failed: ${errorMessage}` });
        return;
      }

      const result = (await apiResponse.json()) as { link: string };

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Complete your upload')
          .setStyle(ButtonStyle.Link)
          .setURL(result.link),
      );

      await interaction.editReply({
        content: `Schematic file received! Complete your upload by adding a name, description, tags, and preview image:`,
        components: [row],
      });
    } catch (error) {
      console.error('Upload command failed:', error);
      await interaction.editReply({ content: 'An unexpected error occurred while uploading.' });
    }
  },
};
