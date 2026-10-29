import { readFileSync } from 'node:fs';
import { type Client, type Guild, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { config } from './config.js';

/**
 * Reports the bot's health, the servers it is in, and what it has been doing to the website's
 * admin monitor (POST /api/v1/bot/telemetry/heartbeat). Strictly best effort: telemetry must
 * never break or slow down the bot, so failures are swallowed and logged sparingly.
 */

export type ActivityKind = 'command' | 'event' | 'guild' | 'lifecycle' | 'admin' | 'render';

export interface Activity {
  kind: ActivityKind;
  name: string;
  status: 'ok' | 'error' | 'skipped';
  guild_id?: string | null;
  channel_id?: string | null;
  actor_id?: string | null;
  actor_tag?: string | null;
  duration_ms?: number | null;
  message?: string | null;
  correlation_id?: string | null;
  meta?: Record<string, unknown> | null;
  occurred_at: string;
}

/** What the bot needs to sync channels, post schematics and mirror comments. */
const REQUIRED_PERMISSIONS: Record<string, bigint> = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  EmbedLinks: PermissionFlagsBits.EmbedLinks,
  AttachFiles: PermissionFlagsBits.AttachFiles,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  CreatePublicThreads: PermissionFlagsBits.CreatePublicThreads,
  SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads,
  AddReactions: PermissionFlagsBits.AddReactions,
};

const MAX_BUFFER = 500;
const MAX_BATCH = 200;
const FAILURE_LOG_INTERVAL_MS = 5 * 60_000;
const FLUSH_SOON_MS = 2_000;

const version = readVersion();
const startedAt = new Date().toISOString();
const buffer: Activity[] = [];

let client: Client<true> | null = null;
let intervalMs = 30_000;
let timer: NodeJS.Timeout | null = null;
let soonTimer: NodeJS.Timeout | null = null;
let inFlight = false;
let sendAgain = false;
let lastFailureLoggedAt = 0;
let redisReady: () => boolean = () => false;
let capabilities: string[] = [];
let guildSettings: Record<string, Record<string, unknown>> = {};

function readVersion(): string {
  let pkgVersion = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    pkgVersion = pkg.version ?? pkgVersion;
  } catch {
    // Version is cosmetic; never fail startup over it.
  }
  const sha = process.env.BOT_BUILD_SHA?.slice(0, 12);
  return sha ? `${pkgVersion}+${sha}` : pkgVersion;
}

function enabled(): boolean {
  return config.botSecret !== '';
}

/** Queue an activity entry for the next heartbeat. Errors are flushed within a few seconds. */
export function record(activity: Omit<Activity, 'occurred_at'> & { occurred_at?: string }): void {
  if (!enabled()) return;

  buffer.push({ ...activity, message: activity.message?.slice(0, 4000) ?? null, occurred_at: activity.occurred_at ?? new Date().toISOString() });
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }
  if (activity.status === 'error') {
    flushSoon();
  }
}

/** Send a heartbeat shortly, coalescing bursts (guild joins, errors, admin requests). */
export function flushSoon(): void {
  if (!enabled() || soonTimer) return;
  soonTimer = setTimeout(() => {
    soonTimer = null;
    void sendHeartbeat();
  }, FLUSH_SOON_MS);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Per-server switch from the admin page, as of the last heartbeat; undefined until the first one. */
export function guildSetting(guildId: string, key: string): unknown {
  return guildSettings[guildId]?.[key];
}

export function startTelemetry(readyClient: Client<true>, isRedisReady: () => boolean, botCapabilities: string[] = []): void {
  if (!enabled()) {
    console.warn('[telemetry] BOT_SECRET is not set; admin monitoring is disabled');
    return;
  }

  client = readyClient;
  redisReady = isRedisReady;
  capabilities = botCapabilities;
  record({ kind: 'lifecycle', name: 'started', status: 'ok', message: `v${version}, ${readyClient.guilds.cache.size} servers` });
  void sendHeartbeat();
  schedule();
}

function schedule(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void sendHeartbeat(), intervalMs);
  timer.unref();
}

function missingPermissions(guild: Guild): string[] {
  const me = guild.members.me;
  if (!me) return Object.keys(REQUIRED_PERMISSIONS);

  const granted = new PermissionsBitField(me.permissions);
  return Object.entries(REQUIRED_PERMISSIONS)
    .filter(([, flag]) => !granted.has(flag))
    .map(([name]) => name);
}

function guildSnapshot(c: Client<true>) {
  return c.guilds.cache.map((guild) => ({
    id: guild.id,
    name: guild.name,
    icon_url: guild.iconURL({ size: 128 }),
    owner_id: guild.ownerId,
    member_count: guild.memberCount,
    joined_at: guild.joinedAt?.toISOString() ?? null,
    missing_permissions: missingPermissions(guild),
  }));
}

export async function sendHeartbeat(): Promise<void> {
  if (!client) return;
  if (inFlight) {
    // Something asked for a beat mid-request (an error, an admin ping): send another after.
    sendAgain = true;
    return;
  }
  inFlight = true;

  const batch = buffer.splice(0, MAX_BATCH);
  const ping = client.ws.ping;

  try {
    const response = await fetch(`${config.api.baseUrl}/api/v1/bot/telemetry/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Bot-Secret': config.botSecret,
      },
      body: JSON.stringify({
        application_id: client.application.id,
        user_tag: client.user.tag,
        avatar_url: client.user.displayAvatarURL({ size: 128 }),
        version,
        node_version: process.version,
        dev_mode: config.devMode,
        started_at: startedAt,
        gateway_ping_ms: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null,
        memory_rss_mb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
        redis_ready: redisReady(),
        capabilities,
        guilds_complete: true,
        guilds: guildSnapshot(client),
        activities: batch,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // 422 means the payload itself is bad; retrying it would fail forever, so drop it.
      if (response.status !== 422) requeue(batch);
      throw new Error(`HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      data?: { heartbeat_interval?: number; guild_settings?: Record<string, Record<string, unknown>> };
    };
    if (body.data?.guild_settings) guildSettings = body.data.guild_settings;
    const next = (body.data?.heartbeat_interval ?? 30) * 1000;
    if (next >= 5_000 && next !== intervalMs) {
      intervalMs = next;
      schedule();
    }
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith('HTTP '))) requeue(batch);
    const now = Date.now();
    if (now - lastFailureLoggedAt > FAILURE_LOG_INTERVAL_MS) {
      lastFailureLoggedAt = now;
      console.warn(`[telemetry] heartbeat failed (${errorMessage(error)}); will keep retrying quietly`);
    }
  } finally {
    inFlight = false;
    if (sendAgain) {
      sendAgain = false;
      flushSoon();
    }
  }
}

function requeue(batch: Activity[]): void {
  buffer.unshift(...batch);
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(MAX_BUFFER);
  }
}
