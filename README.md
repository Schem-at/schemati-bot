# Schemati Bot

Discord bot for [schemat.io](https://schemat.io), a platform for sharing Minecraft schematics.

The bot connects a Discord server to a Schemati community. It can link channels, mirror schematic activity into Discord forum threads, and let members upload schematics straight from Discord.

## Commands

| Command | Description |
| --- | --- |
| `/ping` | Check if the bot is online |
| `/whoami` | Check your linked Schemati account |
| `/setup` | Link this Discord server to a Schemati community |
| `/cleanup` | Unlink this server from Schemati and remove synced channels |
| `/upload` | Upload a schematic to schemat.io (`.schem`, `.schematic`, `.litematic`, `.mcstructure`) |
| `/populate-forums` | Create forum threads for all existing schematics in mapped channels |

## How it works

This bot is a companion to the Schemati web application and shares its infrastructure:

- It reads from the Schemati PostgreSQL database through Drizzle ORM.
- It subscribes to Redis pub/sub events published by the web application to mirror activity into Discord.
- It calls the Schemati HTTP API for actions such as uploads.

It does not run its own database. It expects the same PostgreSQL database and Redis instance that the web application uses.

## Tech stack

- TypeScript
- discord.js v14
- Drizzle ORM (PostgreSQL)
- ioredis (Redis pub/sub)
- tsx for development, tsc for builds

## Requirements

- Node.js 20 or newer
- Access to a Schemati PostgreSQL database and a Redis instance
- A Discord application with a bot token

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file and fill in the values:

   ```bash
   cp .env.example .env
   ```

3. Register the slash commands with Discord:

   ```bash
   npm run deploy-commands
   ```

4. Run the bot in development (watch mode):

   ```bash
   npm run dev
   ```

   Or build and run the compiled output:

   ```bash
   npm run build
   npm start
   ```

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | yes | | Discord bot token |
| `DISCORD_CLIENT_ID` | yes | | Discord application client id |
| `DISCORD_DEV_GUILD_ID` | no | | Guild id used when dev mode is enabled |
| `DEV_MODE` | no | `false` | When true, the bot only responds to and deploys commands to the dev guild |
| `DATABASE_URL` | yes | | PostgreSQL connection string for the Schemati database |
| `API_BASE_URL` | yes | | Base URL of the Schemati API |
| `API_TOKEN` | no | | Token for authenticated API calls |
| `STORAGE_BASE_URL` | no | `http://localhost:9000` | Object storage base URL |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis connection string |
| `REDIS_PREFIX` | no | `schemati_database_` | Key prefix for Redis pub/sub channels |
| `BOT_SECRET` | no | | Shared secret used to verify requests |

Configuration is read entirely from environment variables. Never commit your `.env` file.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run in watch mode with tsx |
| `npm run build` | Compile TypeScript to `dist` |
| `npm start` | Run the compiled bot |
| `npm run deploy-commands` | Register slash commands with Discord |
| `npm run db:pull` | Introspect the database schema with drizzle-kit |
| `npm run db:studio` | Open Drizzle Studio |
