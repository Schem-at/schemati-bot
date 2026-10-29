import { type Message, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { errorMessage, guildSetting, record } from '../telemetry.js';

/**
 * Auto-render: when someone drops a schematic file in a server, ask the website for a render
 * (done by a render node), wait for it, and reply with the picture. Every way this can fail is
 * silent in Discord; outcomes are reported to the admin monitor as `render` activity.
 */

const SCHEMATIC_FILE = /\.(schem|schematic|litematic)$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IN_FLIGHT = 4;
const POLL_INTERVAL_MS = 1_000;
const TYPING_INTERVAL_MS = 8_000;
const GIVE_UP_AFTER_MS = 200_000;

interface RenderJob {
  id: string;
  status: 'queued' | 'claimed' | 'done' | 'failed' | 'expired';
  node: string | null;
  block_count: number | null;
  render_ms: number | null;
  error_code: string | null;
  error: string | null;
}

let inFlight = 0;

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.api.baseUrl}/api/v1/bot/renders${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Bot-Secret': config.botSecret, ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
}

function canReply(message: Message<true>): boolean {
  const me = message.guild.members.me;
  if (!me) return false;
  const permissions = message.channel.permissionsFor(me);
  const send = message.channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  return permissions?.has([PermissionFlagsBits.ViewChannel, send, PermissionFlagsBits.AttachFiles]) ?? false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function onMessageCreate(message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild() || config.botSecret === '') return;

  const attachment = message.attachments.find((a) => SCHEMATIC_FILE.test(a.name) && a.size <= MAX_FILE_BYTES);
  if (!attachment) return;
  if (guildSetting(message.guildId, 'auto_render') === false) return;
  if (inFlight >= MAX_IN_FLIGHT || !canReply(message)) return;

  inFlight += 1;
  const startedAt = Date.now();
  const base = { kind: 'render' as const, name: 'auto_render', guild_id: message.guildId, channel_id: message.channelId, actor_id: message.author.id, actor_tag: message.author.tag };

  try {
    const created = await api('', {
      method: 'POST',
      body: JSON.stringify({
        source_url: attachment.url,
        file_name: attachment.name,
        file_size: attachment.size,
        guild_id: message.guildId,
        channel_id: message.channelId,
        message_id: message.id,
        actor_id: message.author.id,
        actor_tag: message.author.tag,
      }),
    });
    if (created.status === 409) {
      const body = (await created.json().catch(() => ({}))) as { reason?: string };
      if (body.reason !== 'disabled') {
        record({ ...base, status: 'skipped', message: `${attachment.name}: ${body.reason ?? 'unavailable'}` });
      }
      return;
    }
    if (!created.ok) throw new Error(`render request failed: HTTP ${created.status}`);

    let job = ((await created.json()) as { data: RenderJob }).data;
    let lastTyping = 0;
    while (job.status === 'queued' || job.status === 'claimed') {
      if (Date.now() - startedAt > GIVE_UP_AFTER_MS) throw new Error('gave up waiting for the render');
      if (Date.now() - lastTyping > TYPING_INTERVAL_MS && job.status === 'claimed') {
        lastTyping = Date.now();
        void message.channel.sendTyping().catch(() => {});
      }
      await sleep(POLL_INTERVAL_MS);
      const polled = await api(`/${job.id}`);
      if (!polled.ok) throw new Error(`render status failed: HTTP ${polled.status}`);
      job = ((await polled.json()) as { data: RenderJob }).data;
    }

    if (job.status !== 'done') {
      // Too large, unparsable, timed out: nothing worth telling the channel about.
      const skippedCodes = ['too_large', 'no_node'];
      record({
        ...base,
        status: skippedCodes.includes(job.error_code ?? '') ? 'skipped' : 'error',
        duration_ms: Date.now() - startedAt,
        message: `${attachment.name}: ${job.error_code ?? job.status}${job.error ? ` (${job.error})` : ''}`,
        meta: { job_id: job.id, node: job.node },
      });
      return;
    }

    const image = await api(`/${job.id}/image`, { headers: { Accept: 'image/png' } });
    if (!image.ok) throw new Error(`render image failed: HTTP ${image.status}`);
    const png = Buffer.from(await image.arrayBuffer());

    const stats = [attachment.name, job.block_count !== null ? `${job.block_count.toLocaleString('en-US')} blocks` : null].filter(Boolean).join(' · ');
    await message.reply({
      content: `-# ${stats}`,
      files: [{ attachment: png, name: `${attachment.name.replace(SCHEMATIC_FILE, '')}.png` }],
      allowedMentions: { parse: [], repliedUser: false },
    });

    record({
      ...base,
      status: 'ok',
      duration_ms: Date.now() - startedAt,
      message: `${attachment.name} rendered by ${job.node ?? 'a render node'}`,
      meta: { job_id: job.id, node: job.node, block_count: job.block_count, render_ms: job.render_ms },
    });
  } catch (error) {
    console.warn(`[render] ${attachment.name} in ${message.guildId}: ${errorMessage(error)}`);
    record({ ...base, status: 'error', duration_ms: Date.now() - startedAt, message: `${attachment.name}: ${errorMessage(error)}` });
  } finally {
    inFlight -= 1;
  }
}
