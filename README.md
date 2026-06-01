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
| `DATABASE_URL` | yes (or `DB_*`) | | PostgreSQL connection string. Alternatively set `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` (and optional `DB_SSLMODE`) |
| `API_BASE_URL` | yes (or `APP_URL`) | | Public base URL of the app. It builds clickable links in Discord, so use the public URL. Falls back to `APP_URL` |
| `API_TOKEN` | no | | Token for authenticated API calls |
| `STORAGE_BASE_URL` | no | `AWS_URL` or `http://localhost:9000` | Object storage base URL |
| `REDIS_URL` | no (or `REDIS_*`) | `redis://localhost:6379` | Redis connection string. Alternatively set `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` |
| `REDIS_PREFIX` | no | `slug(APP_NAME)_database_` | Key prefix for Redis pub/sub channels. Must match the web application |
| `BOT_SECRET` | no | | Shared secret for bot uploads. Must match the web application's `BOT_SECRET` |

Configuration is read entirely from environment variables. The bot accepts either single
connection strings (`DATABASE_URL`, `REDIS_URL`) or the discrete Laravel-style variables
(`DB_*`, `REDIS_*`), so it can reuse the same environment as the web application. Never
commit your `.env` file.

If Postgres is unreachable at startup the bot retries, then exits so the platform restarts it.
If Redis drops, the bot logs the failure and keeps reconnecting. Neither fails silently.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run in watch mode with tsx |
| `npm run build` | Compile TypeScript to `dist` |
| `npm start` | Run the compiled bot |
| `npm run deploy-commands` | Register slash commands with Discord |
| `npm run db:pull` | Introspect the database schema with drizzle-kit |
| `npm run db:studio` | Open Drizzle Studio |
