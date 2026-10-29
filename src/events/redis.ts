import Redis from 'ioredis';
import type { Client } from 'discord.js';
import { config } from '../config.js';
import { deployCommands } from '../commands/deploy.js';
import { errorMessage, record, sendHeartbeat } from '../telemetry.js';
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

interface AdminEvent extends BotEvent {
  type: 'admin.ping' | 'admin.refresh' | 'admin.redeploy_commands' | 'admin.leave_guild';
  requestId?: string;
  guildId?: string;
}

function isAdminEvent(event: BotEvent): event is AdminEvent {
  return typeof event.type === 'string' && event.type.startsWith('admin.');
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
    throw error;
  }
}

async function handleChannelsSync(client: Client, event: ChannelsSyncEvent): Promise<void> {
  console.log(`Processing channels.sync for community ${event.communityId}`);

  const guild = client.guilds.cache.get(event.guildId);
  if (!guild) {
    throw new Error(`Guild ${event.guildId} not found in cache (is the bot still in that server?)`);
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
    throw new Error(`Guild ${event.guildId} not found in cache (is the bot still in that server?)`);
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
    throw new Error(`Guild ${event.guildId} not found in cache (is the bot still in that server?)`);
  }

  await postCommentToThread(guild, event.threadId, event.author, event.authorUuid, event.content);
}

async function handleChannelsCleanup(client: Client, event: ChannelsCleanupEvent): Promise<void> {
  console.log(`Processing channels.cleanup for community ${event.communityId}`);

  const guild = client.guilds.cache.get(event.guildId);
  if (!guild) {
    throw new Error(`Guild ${event.guildId} not found in cache (is the bot still in that server?)`);
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

/**
 * Commands from the website's admin monitor. The outcome is recorded like any other event;
 * ping and refresh answer straight away so the admin page updates promptly.
 */
async function handleAdmin(client: Client, event: AdminEvent): Promise<void> {
  switch (event.type) {
    case 'admin.ping':
      record({ kind: 'admin', name: 'admin.ping', status: 'ok', correlation_id: event.requestId ?? null });
      await sendHeartbeat();
      return;
    case 'admin.refresh':
      await sendHeartbeat();
      return;
    case 'admin.redeploy_commands':
      await deployCommands();
      return;
    case 'admin.leave_guild': {
      const guild = event.guildId ? client.guilds.cache.get(event.guildId) : undefined;
      if (!guild) {
        throw new Error(`Guild ${event.guildId} not found in cache`);
      }
      console.log(`[admin] leaving guild ${guild.name} (${guild.id})`);
      await guild.leave();
      return;
    }
    default:
      throw new Error(`Unknown admin command ${event.type}`);
  }
}

export const CHANNEL = `${config.redis.prefix}bot:events`;

let activeSubscriber: Redis | null = null;
let subscribed = false;

/** True while the subscriber is connected and listening (ioredis resubscribes on reconnect). */
export function isRedisReady(): boolean {
  return subscribed && activeSubscriber?.status === 'ready';
}

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

  activeSubscriber = subscriber;

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
    subscribed = true;
    console.log(`[redis] subscribed to ${CHANNEL}`);
  });

  subscriber.on('message', async (_channel: string, message: string) => {
    let parsed: BotEvent;
    try {
      parsed = JSON.parse(message) as BotEvent;
    } catch (error) {
      console.error('Error parsing Redis event:', error);
      record({ kind: 'event', name: 'invalid', status: 'error', message: `Unparseable event: ${errorMessage(error)}` });
      return;
    }

    const event = parsed;
    const startedAt = Date.now();
    const isAdmin = isAdminEvent(event);
    const base = {
      kind: isAdmin ? ('admin' as const) : ('event' as const),
      name: String(event.type ?? 'unknown').slice(0, 100),
      guild_id: typeof event.guildId === 'string' ? event.guildId : null,
      channel_id: typeof event.channelId === 'string' ? event.channelId : typeof event.threadId === 'string' ? event.threadId : null,
      actor_id: typeof event.discordId === 'string' ? event.discordId : null,
    };

    try {
      let handled = true;
      if (isAdmin) {
        await handleAdmin(client, event);
      } else if (isDiscordLinkedEvent(event)) {
        await handleDiscordLinked(client, event);
      } else if (isChannelsSyncEvent(event)) {
        await handleChannelsSync(client, event);
      } else if (isChannelsCleanupEvent(event)) {
        await handleChannelsCleanup(client, event);
      } else if (isSchematicPostedEvent(event)) {
        await handleSchematicPosted(client, event);
      } else if (isCommentPostedEvent(event)) {
        await handleCommentPosted(client, event);
      } else {
        handled = false;
      }

      // admin.ping records its own answer (with the correlation id) before flushing.
      if (event.type !== 'admin.ping') {
        record({
          ...base,
          status: handled ? 'ok' : 'error',
          duration_ms: Date.now() - startedAt,
          message: handled ? null : 'Unrecognised or malformed event',
        });
      }
    } catch (error) {
      console.error('Error handling Redis event:', error);
      record({ ...base, status: 'error', duration_ms: Date.now() - startedAt, message: errorMessage(error) });
    }
  });
}
