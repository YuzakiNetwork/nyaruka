# Nyaruka

Bot WhatsApp untuk petualangan interaktif, karakter, duel, dan eksplorasi.

## Setup and run

- Use Node.js 20 or newer.
- Install dependencies with `npm ci`.
- Configure the deployment in a local, untracked `.env` file. `BOT_NUMBER` is required to connect; set owner and optional feature settings as needed. Do not commit `.env` or the WhatsApp authentication/session directory.
- Start with `npm start`. On first connection, the pairing code is shown only on an attached interactive terminal; it is never written to Pino or PM2 logs. If pairing is needed for a PM2-managed process, stop that instance and start one interactive instance to link the device.
- For development, use `npm run dev`. If PM2 is installed, `npm run pm2`, `npm run pm2:stop`, `npm run pm2:restart`, and `npm run pm2:logs` manage the configured process. Keep one bot instance writing to the JSON database.

### Configuration names

The application reads these environment-variable names; this list intentionally contains names only, not values:

- **Runtime:** `NODE_ENV`
- **Bot and WhatsApp:** `BOT_NUMBER`, `BOT_NAME`, `BOT_OWNER_NUMBER`, `BOT_OWNER_LID`, `BOT_OWNER`, `BOT_PREFIX`, `BOT_PREFIXES`, `SESSION_NAME`
- **Storage and logging:** `DB_PATH`, `LOG_LEVEL`
- **Cooldowns:** `BATTLE_COOLDOWN`, `DUNGEON_COOLDOWN`, `SHOP_COOLDOWN`
- **Economy:** `ECONOMY_TICK_INTERVAL`, `PRICE_FLOOR`, `PRICE_CAP`, `SHOP_SELL_RATIO`, `DEMAND_DECAY_RATE`, `PRICE_MEAN_REVERSION_RATE`, `PRICE_VOLATILITY_BASE`
- **Donations:** `DONATE_ENABLED`, `TRAKTEER_API_KEY`, `TRAKTEER_POLL_INTERVAL`, `DONATE_NOTIFY`

## Commands

Send commands in WhatsApp using a configured prefix. `!help` gives a concise onboarding guide instead of printing every command. Use `!help game` (or the existing `!help rpg` alias) for the full Game command list, `!help economy`, `!help social`, or `!help info` for each full category list, and `!help <command>` for command usage; replace `!` if your deployment uses another prefix. Commands and aliases are discovered from the command modules at startup.

Current categories include:

- **Game** (`!help game`; `!help rpg` remains supported): adventure, battle, craft, dungeon, equip, gacha, inventory, quest, and other character/gameplay commands.
- **Ekonomi** (`!help economy`): buy, market, price, sell, and shop.
- **Sosial** (`!help social`): inspect and transfer.
- **Info** (`!help info`): help/menu, ping, and WhatsApp ID utilities.
- **Owner** (`!help owner`, owner only): administration, maintenance, reload/system tools, and file inspection.

The owner file manager is intentionally **read-only**: `getfile`, `listfiles`, and `statfile` remain available within the bot directory. File writes, appends, moves, and deletions are refused for safety. **Never use any filemanager command to read, copy, or send `.env`, WhatsApp authentication/session files, tokens, or credentials.**

## Architecture

`index.js` starts the Baileys connection, pairing/reconnect flow, and scheduled economy/world-event jobs. `lib/whatsapp/reliability.js` serializes auth writes, tracks and retries a failed credential save before loading auth for a restarted socket, retries transient disconnects with capped exponential backoff and jitter, and prevents overlapping sockets. Auth is preserved for timeouts and ambiguous errors; only an explicitly identified terminal `loggedOut` quarantines the existing session directory—a bare 401 is not enough. Clean closes and unknown WebSocket errors retire the stale socket and retry without quarantining auth. Reconnect logs distinguish transient disconnects from confirmed logout; the local-reset message is emitted only after a successful session-directory reset. Quarantine backups stay beside the session directory and are ignored by Git. Non-retryable failures stop automatic retries without deleting auth. Pairing codes are displayed only on an attached interactive terminal; Pino redacts code-bearing fields, and redirected stdout (including PM2 output) never receives the pairing value. `handler/index.js` discovers command modules recursively, dispatches messages, applies cooldowns and rate limits, and supports command hot reload. Game and economy logic lives in `lib/game/`; `lib/database/db.js` routes persistence to the JSON adapter in `lib/database/json.js`, which uses cached collections, private temporary files, atomic replacement, and backups. Before replacing an existing collection, the adapter creates or replaces one latest backup at `${collection}.json.bak`; this is not an archive, and backups are not restored automatically. The JSON adapter assumes a single writer; it is not a multi-process lock. `webhook/trakteer.js` provides the optional donation integration.

## Tests

Run the available test suites with Node's built-in test runner:

```sh
DOTENV_CONFIG_PATH=/dev/null node --test test/*.test.js
```

This covers JSON persistence, owner filemanager path/read-only behavior, and WhatsApp session/reconnect reliability using synthetic temporary auth markers. It verifies transient 408 and clean-close retries, cause-specific reconnect copy and success-only reset wording, explicit-`loggedOut`-only quarantine, single-flight backoff, failed-save retry before restart, unknown WebSocket recovery, pairing-code log redaction, and sanitized credential-save failures. There is no `npm test` script currently.

## Maintainer guidance

For every release or merged update, bump `package.json` using SemVer and keep `package-lock.json` in sync. Update this README whenever setup, configuration names, command categories/behavior, architecture, or test instructions change. Treat re-enabling any filemanager mutation as a security-sensitive change and add appropriate race-resistant path handling and tests first.
