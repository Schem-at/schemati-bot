import { pgTable, uuid, varchar, text, timestamp, boolean, integer, bigint, serial } from 'drizzle-orm/pg-core';

// Subset of Laravel's tables that the bot needs to read

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').notNull().unique(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const players = pgTable('players', {
  id: uuid('id').primaryKey(),
  lastSeenName: varchar('last_seen_name', { length: 255 }),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const userSocials = pgTable('user_socials', {
  id: serial('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  platform: varchar('platform', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }),
  username: varchar('username', { length: 255 }).notNull(),
  url: varchar('url', { length: 255 }),
  avatarUrl: varchar('avatar_url', { length: 255 }),
  isVisible: boolean('is_visible').default(true),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const schematics = pgTable('schematics', {
  id: varchar('id', { length: 255 }).primaryKey(),
  shortId: varchar('short_id', { length: 8 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  format: varchar('format', { length: 255 }),
  metaData: text('meta_data'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }),
  parentId: uuid('parent_id'),
  communityId: uuid('community_id'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const communities = pgTable('communities', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  description: text('description'),
  discordGuildId: varchar('discord_guild_id', { length: 255 }),
  discordCategoryId: varchar('discord_category_id', { length: 255 }),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const schematicTag = pgTable('schematic_tag', {
  schematicId: varchar('schematic_id', { length: 255 }).notNull(),
  tagId: uuid('tag_id').notNull(),
});

export const playersSchematics = pgTable('players_schematics', {
  id: serial('id').primaryKey(),
  playerId: uuid('player_id').notNull(),
  schematicId: varchar('schematic_id', { length: 255 }).notNull(),
  role: varchar('role', { length: 255 }),
});

export const communityPlayers = pgTable('community_players', {
  communityId: uuid('community_id').notNull(),
  playerId: uuid('player_id').notNull(),
  role: varchar('role', { length: 255 }),
  isActive: boolean('is_active').default(true),
});

export const discordChannelMappings = pgTable('discord_channel_mappings', {
  id: uuid('id').primaryKey(),
  communityId: uuid('community_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  discordChannelId: varchar('discord_channel_id', { length: 255 }),
  channelName: varchar('channel_name', { length: 255 }),
  channelType: varchar('channel_type', { length: 255 }).default('forum'),
  status: varchar('status', { length: 255 }).default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const media = pgTable('media', {
  id: serial('id').primaryKey(),
  modelType: varchar('model_type', { length: 255 }).notNull(),
  modelId: varchar('model_id', { length: 255 }).notNull(),
  collectionName: varchar('collection_name', { length: 255 }).notNull(),
  disk: varchar('disk', { length: 255 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
});

export const discordForumPosts = pgTable('discord_forum_posts', {
  id: uuid('id').primaryKey(),
  schematicId: uuid('schematic_id').notNull(),
  discordChannelMappingId: uuid('discord_channel_mapping_id').notNull(),
  discordThreadId: varchar('discord_thread_id', { length: 255 }).notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});
