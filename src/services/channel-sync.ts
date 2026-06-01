import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ForumChannel,
  type Guild,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  discordChannelMappings,
  discordForumPosts,
  media,
  schematics,
  schematicTag,
  tags,
  players,
  playersSchematics,
} from '../db/schema.js';
import { config } from '../config.js';

interface CreateRequest {
  mappingId: string;
  channelName: string;
  channelType?: 'text' | 'forum';
}

interface DeleteRequest {
  mappingId: string;
  channelId: string;
}

/**
 * Create Discord channels (text or forum) under a category and update DB mappings.
 * For forum channels, permission overwrites prevent regular users from creating threads
 * while allowing the bot to create and manage them.
 */
export async function createChannels(
  guild: Guild,
  categoryId: string | null,
  requests: CreateRequest[],
  botUserId?: string,
): Promise<void> {
  for (const req of requests) {
    try {
      const type = req.channelType === 'forum' ? ChannelType.GuildForum : ChannelType.GuildText;

      // For forum channels, lock down thread creation to bot only
      const permissionOverwrites = req.channelType === 'forum' && botUserId
        ? [
            {
              id: guild.id, // @everyone
              deny: [PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads],
              allow: [PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ViewChannel],
            },
            {
              id: botUserId,
              allow: [
                PermissionFlagsBits.CreatePublicThreads,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.ManageThreads,
              ],
            },
          ]
        : undefined;

      const channel = await guild.channels.create({
        name: req.channelName,
        type,
        ...(categoryId ? { parent: categoryId } : {}),
        ...(permissionOverwrites ? { permissionOverwrites } : {}),
      });

      await db
        .update(discordChannelMappings)
        .set({
          discordChannelId: channel.id,
          status: 'active',
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(discordChannelMappings.id, req.mappingId));

      console.log(`Created channel #${req.channelName} (${channel.id}) for mapping ${req.mappingId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to create channel ${req.channelName}:`, message);

      await db
        .update(discordChannelMappings)
        .set({
          status: 'failed',
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(discordChannelMappings.id, req.mappingId));
    }
  }
}

/**
 * Delete Discord channels and remove their DB mappings.
 */
export async function deleteChannels(
  guild: Guild,
  requests: DeleteRequest[],
): Promise<void> {
  for (const req of requests) {
    try {
      const channel = guild.channels.cache.get(req.channelId)
        ?? await guild.channels.fetch(req.channelId).catch(() => null);

      if (channel) {
        await channel.delete();
        console.log(`Deleted channel ${req.channelId} for mapping ${req.mappingId}`);
      }

      await db
        .delete(discordChannelMappings)
        .where(eq(discordChannelMappings.id, req.mappingId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to delete channel ${req.channelId}:`, message);

      await db
        .update(discordChannelMappings)
        .set({
          status: 'failed',
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(discordChannelMappings.id, req.mappingId));
    }
  }
}

/**
 * Delete a category channel from Discord.
 */
export async function deleteCategory(guild: Guild, categoryId: string): Promise<void> {
  try {
    const category = guild.channels.cache.get(categoryId)
      ?? await guild.channels.fetch(categoryId).catch(() => null);

    if (category) {
      await category.delete();
      console.log(`Deleted category ${categoryId}`);
    }
  } catch (error) {
    console.error(`Failed to delete category ${categoryId}:`, error);
  }
}

export interface SchematicTag {
  name: string;
  color: string | null;
}

export interface SchematicData {
  name: string;
  description: string | null;
  format: string | null;
  author: string;
  authorUuid: string | null;
  shortId: string;
  previewUrl: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  tags: SchematicTag[];
  blockCount: number | null;
  volume: number | null;
  dimensions: string | null;
}

/** Map schematic format to Discord embed color (decimal). */
function getFormatColor(format: string | null): number {
  switch (format) {
    case 'schem':
    case 'schematic':
      return 0xfb923c; // Orange
    case 'litematic':
      return 0x38bdf8; // Light blue
    case 'mcstructure':
    case 'mcstructures':
      return 0x4ade80; // Green
    default:
      return 0x38bdf8; // Default light blue
  }
}

/** Map a hex color to the closest Discord emoji circle. */
function colorToEmoji(hex: string | null): string {
  if (!hex) return '\u{1F535}'; // 🔵 default blue

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Simple heuristic: pick closest emoji by dominant channel
  if (r > 180 && g < 100 && b < 100) return '\u{1F534}'; // 🔴 red
  if (r > 200 && g > 150 && b < 100) return '\u{1F7E0}'; // 🟠 orange
  if (r > 200 && g > 200 && b < 100) return '\u{1F7E1}'; // 🟡 yellow
  if (r < 100 && g > 150 && b < 100) return '\u{1F7E2}'; // 🟢 green
  if (r < 100 && g < 100 && b > 150) return '\u{1F535}'; // 🔵 blue
  if (r > 120 && g < 80 && b > 150) return '\u{1F7E3}'; // 🟣 purple
  if (r > 150 && g > 100 && b < 80) return '\u{1F7E4}'; // 🟤 brown
  if (r > 200 && g > 200 && b > 200) return '\u{26AA}';  // ⚪ white
  if (r < 60 && g < 60 && b < 60) return '\u{26AB}';     // ⚫ black

  return '\u{1F535}'; // 🔵 default blue
}

/**
 * Post a rich embed for a new schematic to a Discord channel.
 */
export async function postSchematicEmbed(
  guild: Guild,
  channelId: string,
  schematic: SchematicData,
): Promise<void> {
  try {
    const channel = guild.channels.cache.get(channelId)
      ?? await guild.channels.fetch(channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
      console.error(`Channel ${channelId} not found or not text-based`);
      return;
    }

    const schematicUrl = `${config.api.baseUrl}/schematics/${schematic.shortId}`;

    const embed = new EmbedBuilder()
      .setTitle(schematic.name)
      .setURL(schematicUrl)
      .setColor(getFormatColor(schematic.format))
      .setTimestamp();

    // Player avatar via mc-heads.net
    if (schematic.authorUuid) {
      embed.setAuthor({
        name: schematic.author,
        iconURL: `https://mc-heads.net/avatar/${schematic.authorUuid}/64`,
      });
    } else {
      embed.setAuthor({ name: schematic.author });
    }

    if (schematic.description) {
      embed.setDescription(
        schematic.description.length > 300
          ? schematic.description.substring(0, 297) + '...'
          : schematic.description,
      );
    }

    // Metadata fields
    const metaFields: Array<{ name: string; value: string; inline: boolean }> = [];

    if (schematic.blockCount !== null) {
      metaFields.push({ name: 'Blocks', value: schematic.blockCount.toLocaleString(), inline: true });
    }
    if (schematic.volume !== null) {
      metaFields.push({ name: 'Volume', value: schematic.volume.toLocaleString(), inline: true });
    }
    if (schematic.dimensions) {
      metaFields.push({ name: 'Dimensions', value: schematic.dimensions, inline: true });
    }

    if (metaFields.length > 0) {
      embed.addFields(metaFields);
    }

    if (schematic.tags.length > 0) {
      embed.addFields({
        name: 'Tags',
        value: schematic.tags.map(t => `${colorToEmoji(t.color)} ${t.name}`).join('\u2002'),
        inline: false,
      });
    }

    if (schematic.format) {
      embed.setFooter({ text: `.${schematic.format}` });
    }

    const files: AttachmentBuilder[] = [];

    // Fetch the preview image and attach it directly
    if (schematic.previewUrl) {
      try {
        const response = await fetch(schematic.previewUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const attachment = new AttachmentBuilder(buffer, { name: 'preview.png' });
          files.push(attachment);
          embed.setImage('attachment://preview.png');
        }
      } catch (imgError) {
        console.warn('Failed to fetch preview image:', imgError);
      }
    }

    // Attach the schematic file for download
    if (schematic.downloadUrl) {
      try {
        const response = await fetch(schematic.downloadUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const fileName = schematic.fileName ?? `${schematic.shortId}.${schematic.format ?? 'schematic'}`;
          const attachment = new AttachmentBuilder(buffer, { name: fileName });
          files.push(attachment);
        }
      } catch (dlError) {
        console.warn('Failed to fetch schematic file:', dlError);
      }
    }

    // Button to open on schemat.io
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Open on schemat.io')
        .setStyle(ButtonStyle.Link)
        .setURL(schematicUrl),
    );

    await (channel as TextChannel).send({ embeds: [embed], files, components: [row] });
    console.log(`Posted schematic "${schematic.name}" to #${channel.name}`);
  } catch (error) {
    console.error(`Failed to post schematic embed to channel ${channelId}:`, error);
  }
}

/**
 * Create a forum thread for a schematic and save the mapping to the database.
 */
export async function createForumThread(
  guild: Guild,
  channelId: string,
  schematic: SchematicData,
  schematicId: string,
  mappingId: string,
): Promise<void> {
  try {
    // Check for existing thread to prevent duplicates
    const existing = await db
      .select()
      .from(discordForumPosts)
      .where(
        and(
          eq(discordForumPosts.schematicId, schematicId),
          eq(discordForumPosts.discordChannelMappingId, mappingId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(`Forum thread already exists for schematic ${schematicId} in mapping ${mappingId}`);
      return;
    }

    const channel = guild.channels.cache.get(channelId)
      ?? await guild.channels.fetch(channelId).catch(() => null);

    if (!channel || channel.type !== ChannelType.GuildForum) {
      console.error(`Channel ${channelId} not found or not a forum channel`);
      return;
    }

    const forumChannel = channel as ForumChannel;
    const schematicUrl = `${config.api.baseUrl}/schematics/${schematic.shortId}`;

    // Build the embed (same as text channel embed)
    const embed = new EmbedBuilder()
      .setTitle(schematic.name)
      .setURL(schematicUrl)
      .setColor(getFormatColor(schematic.format))
      .setTimestamp();

    if (schematic.authorUuid) {
      embed.setAuthor({
        name: schematic.author,
        iconURL: `https://mc-heads.net/avatar/${schematic.authorUuid}/64`,
      });
    } else {
      embed.setAuthor({ name: schematic.author });
    }

    if (schematic.description) {
      embed.setDescription(
        schematic.description.length > 300
          ? schematic.description.substring(0, 297) + '...'
          : schematic.description,
      );
    }

    const metaFields: Array<{ name: string; value: string; inline: boolean }> = [];
    if (schematic.blockCount !== null) {
      metaFields.push({ name: 'Blocks', value: schematic.blockCount.toLocaleString(), inline: true });
    }
    if (schematic.volume !== null) {
      metaFields.push({ name: 'Volume', value: schematic.volume.toLocaleString(), inline: true });
    }
    if (schematic.dimensions) {
      metaFields.push({ name: 'Dimensions', value: schematic.dimensions, inline: true });
    }
    if (metaFields.length > 0) {
      embed.addFields(metaFields);
    }

    if (schematic.tags.length > 0) {
      embed.addFields({
        name: 'Tags',
        value: schematic.tags.map(t => `${colorToEmoji(t.color)} ${t.name}`).join('\u2002'),
        inline: false,
      });
    }

    if (schematic.format) {
      embed.setFooter({ text: `.${schematic.format}` });
    }

    const files: AttachmentBuilder[] = [];
    if (schematic.previewUrl) {
      try {
        const response = await fetch(schematic.previewUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const attachment = new AttachmentBuilder(buffer, { name: 'preview.png' });
          files.push(attachment);
          embed.setImage('attachment://preview.png');
        }
      } catch (imgError) {
        console.warn('Failed to fetch preview image:', imgError);
      }
    }

    // Attach the schematic file for download
    if (schematic.downloadUrl) {
      try {
        const response = await fetch(schematic.downloadUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const fileName = schematic.fileName ?? `${schematic.shortId}.${schematic.format ?? 'schematic'}`;
          const attachment = new AttachmentBuilder(buffer, { name: fileName });
          files.push(attachment);
        }
      } catch (dlError) {
        console.warn('Failed to fetch schematic file:', dlError);
      }
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Open on schemat.io')
        .setStyle(ButtonStyle.Link)
        .setURL(schematicUrl),
    );

    // Truncate thread name to Discord's 100 character limit
    const threadName = schematic.name.length > 100
      ? schematic.name.substring(0, 97) + '...'
      : schematic.name;

    const thread = await forumChannel.threads.create({
      name: threadName,
      message: { embeds: [embed], files, components: [row] },
    });

    // Save the forum post mapping
    await db.insert(discordForumPosts).values({
      id: randomUUID(),
      schematicId,
      discordChannelMappingId: mappingId,
      discordThreadId: thread.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`Created forum thread "${threadName}" (${thread.id}) for schematic ${schematicId}`);
  } catch (error) {
    console.error(`Failed to create forum thread for schematic ${schematicId}:`, error);
  }
}

/**
 * Post a comment to an existing Discord forum thread.
 */
export async function postCommentToThread(
  guild: Guild,
  threadId: string,
  author: string,
  authorUuid: string | null,
  content: string,
): Promise<void> {
  try {
    const thread = guild.channels.cache.get(threadId) as ThreadChannel | undefined
      ?? await guild.channels.fetch(threadId).catch(() => null) as ThreadChannel | null;

    if (!thread || !thread.isThread()) {
      console.error(`Thread ${threadId} not found or not a thread`);
      return;
    }

    // Unarchive the thread if it's archived
    if (thread.archived) {
      await thread.setArchived(false);
    }

    const embed = new EmbedBuilder()
      .setDescription(content)
      .setColor(0x5865f2) // Discord blurple
      .setTimestamp();

    if (authorUuid) {
      embed.setAuthor({
        name: author,
        iconURL: `https://mc-heads.net/avatar/${authorUuid}/64`,
      });
    } else {
      embed.setAuthor({ name: author });
    }

    await thread.send({ embeds: [embed] });
    console.log(`Posted comment by ${author} to thread ${threadId}`);
  } catch (error) {
    console.error(`Failed to post comment to thread ${threadId}:`, error);
  }
}

/**
 * Populate forum channels with threads for all existing schematics.
 * Used after channel creation and by the /populate-forums command.
 */
export async function populateForumChannels(
  guild: Guild,
  mappingIds: string[],
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Load the mappings that are now active forum channels
  const activeMappings = await db
    .select()
    .from(discordChannelMappings)
    .where(
      and(
        eq(discordChannelMappings.channelType, 'forum'),
        eq(discordChannelMappings.status, 'active'),
      ),
    );

  // Filter to only requested mapping IDs
  const mappings = activeMappings.filter((m) => mappingIds.includes(m.id));

  for (const mapping of mappings) {
    if (!mapping.discordChannelId) continue;

    // Collect the mapped tag and all its descendants
    const tagIdsToSearch = await collectDescendantTagIds(mapping.tagId);

    // Find schematics with any of these tags
    const schematicIdSet = new Set<string>();
    for (const tagId of tagIdsToSearch) {
      const rows = await db
        .select({ schematicId: schematicTag.schematicId })
        .from(schematicTag)
        .where(eq(schematicTag.tagId, tagId));
      for (const row of rows) {
        schematicIdSet.add(row.schematicId);
      }
    }

    const schematicIds = [...schematicIdSet].map((id) => ({ schematicId: id }));

    if (schematicIds.length === 0) continue;

    // Find which already have forum posts for this mapping
    const existingPosts = await db
      .select({ schematicId: discordForumPosts.schematicId })
      .from(discordForumPosts)
      .where(eq(discordForumPosts.discordChannelMappingId, mapping.id));

    const existingSet = new Set(existingPosts.map((p) => p.schematicId));

    const toCreate = schematicIds.filter((s) => !existingSet.has(s.schematicId));
    skipped += existingSet.size;

    for (const { schematicId } of toCreate) {
      try {
        const schematicData = await buildSchematicData(schematicId);
        if (!schematicData) continue;

        await createForumThread(guild, mapping.discordChannelId, schematicData, schematicId, mapping.id);
        created++;
      } catch (error) {
        console.error(`Failed to create forum thread for schematic ${schematicId}:`, error);
        failed++;
      }
    }
  }

  return { created, skipped, failed };
}

/**
 * Collect a tag ID and all its descendant tag IDs from the database.
 */
async function collectDescendantTagIds(rootTagId: string): Promise<string[]> {
  const result: string[] = [rootTagId];
  const queue: string[] = [rootTagId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await db
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.parentId, parentId));

    for (const child of children) {
      result.push(child.id);
      queue.push(child.id);
    }
  }

  return result;
}

/**
 * Build SchematicData from the database for a given schematic ID.
 * Shared between populateForumChannels and the /populate-forums command.
 */
export async function buildSchematicData(schematicId: string): Promise<SchematicData | null> {
  const schematicRows = await db
    .select()
    .from(schematics)
    .where(eq(schematics.id, schematicId))
    .limit(1);

  if (schematicRows.length === 0) return null;
  const schem = schematicRows[0];

  // Fetch author
  const authorRows = await db
    .select({ lastSeenName: players.lastSeenName, id: players.id })
    .from(playersSchematics)
    .innerJoin(players, eq(playersSchematics.playerId, players.id))
    .where(eq(playersSchematics.schematicId, schematicId))
    .limit(1);

  const author = authorRows[0];

  // Fetch tags
  const tagRows = await db
    .select({ name: tags.name })
    .from(schematicTag)
    .innerJoin(tags, eq(schematicTag.tagId, tags.id))
    .where(eq(schematicTag.schematicId, schematicId));

  // Fetch media files (preview image + schematic file)
  const mediaRows = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.modelType, 'App\\Models\\Schematic'),
        eq(media.modelId, schematicId),
      ),
    );

  const previewMedia = mediaRows.find((m) => m.collectionName === 'preview_image');
  const schematicMedia = mediaRows.find((m) => m.collectionName === 'schematic');
  const storageBase = config.storage.baseUrl;

  // URL pattern: {storageBase}/{disk}/{modelId}/{fileName}
  const previewUrl = previewMedia
    ? `${storageBase}/${previewMedia.disk}/${schematicId}/${previewMedia.fileName}`
    : null;
  const downloadUrl = schematicMedia
    ? `${storageBase}/${schematicMedia.disk}/${schematicId}/${schematicMedia.fileName}`
    : null;

  // Parse metadata
  let meta: Record<string, unknown> = {};
  if (schem.metaData) {
    try {
      meta = JSON.parse(schem.metaData);
    } catch {}
  }

  const dims = meta.dimensions as { width?: number; height?: number; depth?: number } | undefined;

  return {
    name: schem.name,
    description: schem.description ? schem.description.replace(/<[^>]*>/g, '').substring(0, 300) : null,
    format: schem.format ?? null,
    author: author?.lastSeenName ?? 'Unknown',
    authorUuid: author?.id ?? null,
    shortId: schem.shortId,
    previewUrl,
    downloadUrl,
    fileName: schematicMedia?.fileName ?? null,
    tags: tagRows.map((t) => ({ name: t.name, color: null })),
    blockCount: (meta.block_count as number) ?? null,
    volume: (meta.volume as number) ?? null,
    dimensions:
      dims?.width && dims?.height && dims?.depth
        ? `${dims.width}×${dims.height}×${dims.depth}`
        : null,
  };
}
