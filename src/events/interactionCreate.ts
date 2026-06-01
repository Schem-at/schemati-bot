import { type Interaction, MessageFlags } from 'discord.js';
import { commands } from '../commands/index.js';
import { config } from '../config.js';

export async function onInteractionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  if (config.devMode && interaction.guildId !== config.discord.devGuildId) {
    await interaction.reply({
      content: "I'm currently in maintenance mode. Please try again later!",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const command = commands.get(interaction.commandName);
  if (!command) {
    console.error(`Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    const guildName = interaction.guild?.name ?? interaction.client.guilds.cache.get(interaction.guildId ?? '')?.name ?? (interaction.guildId ? `guild:${interaction.guildId}` : 'DM');
    console.log(`/${interaction.commandName} by ${interaction.user.tag} in ${guildName}`);
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);

    const reply = { content: 'Something went wrong executing that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}
