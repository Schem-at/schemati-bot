import { eq, and } from 'drizzle-orm';
import { db } from './index.js';
import { users, players, userSocials } from './schema.js';

export interface ResolvedPlayer {
  playerId: string;
  playerName: string | null;
  discordUsername: string;
}

/**
 * Resolve a Discord user ID to a Schemati player.
 * Lookup chain: discord_id → user_socials → users.uuid → players.id
 */
export async function resolvePlayer(discordUserId: string): Promise<ResolvedPlayer | null> {
  const result = await db
    .select({
      playerId: players.id,
      playerName: players.lastSeenName,
      discordUsername: userSocials.username,
    })
    .from(userSocials)
    .innerJoin(users, eq(userSocials.userId, users.id))
    .innerJoin(players, eq(users.uuid, players.id))
    .where(
      and(
        eq(userSocials.platform, 'discord'),
        eq(userSocials.providerId, discordUserId),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}
