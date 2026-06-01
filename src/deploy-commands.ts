import { deployCommands } from './commands/deploy.js';

// Standalone command deployment (npm run deploy-commands). The bot also deploys on startup;
// this script exists for one-off manual deploys.
try {
  await deployCommands();
} catch (error) {
  console.error('Failed to deploy commands:', error);
  process.exit(1);
}
