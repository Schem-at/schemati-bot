import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { onReady } from './events/ready.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { startRedisSubscriber } from './events/redis.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('clientReady', (readyClient) => {
  onReady(readyClient);
  startRedisSubscriber(readyClient);
});
client.on('interactionCreate', onInteractionCreate);

client.login(config.discord.token);
