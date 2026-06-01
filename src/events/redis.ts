import Redis from 'ioredis';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { createChannels, deleteChannels, deleteCategory, postSchematicEmbed, createForumThread, postCommentToThread, populateForumChannels } from '../services/channel-sync.js';

interface BotEvent {
  type: string;
  [key: string]: unknown;
}

interface DiscordLinkedEvent extends BotEvent {
  type: 'discord.linked';
  discordId: string;
  playerName: string;
}

interface ChannelsSyncEvent extends BotEvent {
  type: 'channels.sync';
  communityId: string;
  guildId: string;
  categoryId: string | null;
  create: Array<{ mappingId: string; channelName: string; channelType?: 'text' | 'forum' }>;
  delete: Array<{ mappingId: string; channelId: string }>;
}

interface ChannelsCleanupEvent extends BotEvent {
  type: 'channels.cleanup';
  communityId: string;
  guildId: string;
  categoryId: string | null;
  delete: Array<{ mappingId: string; channelId: string }>;
}

interface SchematicPostedEvent extends BotEvent {
  type: 'schematic.posted';
  guildId: string;
  channelId: string;
  mappingId: string;
  schematicId: string;
  channelType: 'text' | 'forum';
  schematic: {
    name: string;
    description: string | null;
    format: string | null;
    author: string;
    authorUuid: string | null;
    shortId: string;
    previewUrl: string | null;
    downloadUrl: string | null;
    fileName: string | null;
    tags: Array<{ name: string; color: string | null }>;
    blockCount: number | null;
    volume: number | null;
    dimensions: string | null;
  };
}

interface CommentPostedEvent extends BotEvent {
  type: 'comment.posted';
  guildId: string;
  threadId: string;
  author: string;
  authorUuid: string | null;
  content: string;
}

function isDiscordLinkedEvent(event: BotEvent): event is DiscordLinkedEvent {
  return event.type === 'discord.linked'
    && typeof event.discordId === 'string'
    && typeof event.playerName === 'string';
}

function isChannelsSyncEvent(event: BotEvent): event is ChannelsSyncEvent {
  return event.type === 'channels.sync'
    && typeof event.guildId === 'string';
}

function isChannelsCleanupEvent(event: BotEvent): event is ChannelsCleanupEvent {
  return event.type === 'channels.cleanup'
    && typeof event.guildId === 'string';
}

function isSchematicPostedEvent(event: BotEvent): event is SchematicPostedEvent {
  return event.type === 'schematic.posted'
    && typeof event.guildId === 'string'
    && typeof event.channelId === 'string'
    && typeof event.schematic === 'object'
    && event.schematic !== null;
}

function isCommentPostedEvent(event: BotEvent): event is CommentPostedEvent {
  return event.type === 'comment.posted'
    && typeof event.guildId === 'string'
    && typeof event.threadId === 'string'
    && typeof event.content === 'string';
}

async function handleDiscordLinked(client: Client, event: DiscordLinkedEvent): Promise<void> {
  try {
    const user = await client.users.fetch(event.discordId);
    await user.send(
      `Your Discord account has been linked to **${event.playerName}** on schemat.io!`,
    );
    console.log(`DM sent to ${user.tag} for account link`);
  } catch (error) {
    console.error(`Failed to DM user ${event.discordId}:`, error);
  }
}

async function handleChannelsSync(client: Client, event: ChannelsSyncEvent): Promise<void> {
  console.log(`Processing channels.sync for community ${event.communityId}`);

  const guild = client.guilds.cache.get(event.guildId);
  if (!guild) {
    console.error(`Guild ${event.guildId} not found in cache`);
    return;
  }

  // Process deletions first
  if (event.delete.length > 0) {
    await deleteChannels(guild, event.delete);
  }

  // Then creations
  const forumMappingIds: string[] = [];
  if (event.create.length > 0) {
    await createChannels(guild, event.categoryId ?? null, event.create, client.user?.id);

    // Collect forum mapping IDs for auto-population
    for (const req of event.create) {
      if (req.channelType === 'forum') {
        forumMappingIds.push(req.mappingId);
      }
    }
  }

  console.log(`Finished channels.sync: created ${event.create.length}, deleted ${event.delete.length}`);

  // Auto-populate forum channels with existing schematics
  if (forumMappingIds.length > 0) {
    console.log(`Auto-populating ${forumMappingIds.length} forum channel(s) with existing schematics...`);
    const result = await populateForumChannels(guild, forumMappingIds);
    console.log(`Auto-populate complete: created ${result.created}, skipped ${result.skipped}, failed ${result.failed}`);
  }
}

async function handleSchematicPosted(client: Client, event: SchematicPostedEvent): Promise<void> {
  console.log(`Processing schematic.posted: "${event.schematic.name}" → channel ${event.channelId} (${event.channelType})`);

  const guild = client.guilds.cache.get(event.guildId);
  if (!guild) {
    console.error(`Guild ${event.guildId} not found in cache`);
    return;
  }

  if (event.channelType === 'forum') {
    await createForumThread(guild, event.channelId, event.schematic, event.schematicId, event.mappingId);
  } else {
    await postSchematicEmbed(guild, event.channelId, event.schematic);
  }
}

async function handleCommentPosted(client: Client, event: CommentPostedEvent): Promise<void> {
  console.log(`Processing comment.posted: by "${event.author}" → thread ${event.threadId}`);

  const guild = client.guilds.cache.get(event.guildId);
  if (!guild) {
    console.error(`Guild ${event.guildId} not found in cache`);
    return;
  }

  await postCommentToThread(guild, event.threadId, event.author, event.authorUuid, event.content);
}

async function handleChannelsCleanup(client: Client, event: ChannelsCleanupEvent): Promise<void> {
  console.log(`Processing channels.cleanup for community ${event.communityId}`);

  const guild = client.guilds.cache.get(event.guildId);
  if (!guild) {
    console.error(`Guild ${event.guildId} not found in cache`);
    return;
  }

  // Delete all mapped channels
  if (event.delete.length > 0) {
    await deleteChannels(guild, event.delete);
  }

  // Delete the category
  if (event.categoryId) {
    await deleteCategory(guild, event.categoryId);
  }

  console.log(`Finished channels.cleanup for guild ${event.guildId}`);
}

export const CHANNEL = `${config.redis.prefix}bot:events`;

export function startRedisSubscriber(client: Client): void {
  const subscriber = new Redis(config.redis.url, {
    // Keep retrying forever, but make every failure visible rather than silently degrading.
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      const delay = Math.min(times * 1000, 30_000);
      console.error(`[redis] connection failed (attempt ${times}); retrying in ${delay}ms`);
      return delay;
    },
  });

  // Surface every connection state change. A broken Redis used to fail silently: the bot
  // stayed "up" but never received any events from the web app.
  subscriber.on('error', (err) => console.error('[redis] error:', err.message));
  subscriber.on('connect', () => console.log('[redis] connecting...'));
  subscriber.on('ready', () => console.log('[redis] ready'));
  subscriber.on('reconnecting', () => console.warn('[redis] reconnecting...'));
  subscriber.on('end', () => console.error('[redis] connection closed (no more reconnects)'));

  subscriber.subscribe(CHANNEL, (err) => {
    if (err) {
      console.error(`[redis] failed to subscribe to ${CHANNEL}:`, err.message);
      return;
    }
    console.log(`[redis] subscribed to ${CHANNEL}`);
  });

  subscriber.on('message', async (_channel: string, message: string) => {
    try {
      const event = JSON.parse(message) as BotEvent;

      if (isDiscordLinkedEvent(event)) {
        await handleDiscordLinked(client, event);
      } else if (isChannelsSyncEvent(event)) {
        await handleChannelsSync(client, event);
      } else if (isChannelsCleanupEvent(event)) {
        await handleChannelsCleanup(client, event);
      } else if (isSchematicPostedEvent(event)) {
        await handleSchematicPosted(client, event);
      } else if (isCommentPostedEvent(event)) {
        await handleCommentPosted(client, event);
      }
    } catch (error) {
      console.error('Error handling Redis event:', error);
    }
  });
}
