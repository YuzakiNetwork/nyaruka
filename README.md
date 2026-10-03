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

`index.js` starts the Baileys connection, pairing/reconnect flow, and scheduled economy/world-event jobs. `lib/whatsapp/reliability.js` serializes auth writes, tracks and retries failed credential saves and dirty Signal-key writes before loading auth for a restarted socket, retries transient disconnects with capped exponential backoff and jitter, and prevents overlapping sockets. Auth is preserved for timeouts and ambiguous errors; only explicit terminal logout markers or Baileys 6.7.22 `CB:failure` reason 401 quarantine the existing session directory—a bare 401 is not enough. A terminal logout queued during another transition takes priority. Clean closes and unknown WebSocket errors retire the stale socket and retry without quarantining auth, but only after the captured raw WebSocket is confirmed closed; an unconfirmed close blocks reconnect. Uncaught exceptions and unhandled rejections clean up the reconnect controller and exit nonzero for PM2 recovery. Reconnect logs distinguish transient disconnects from confirmed logout; the local-reset message is emitted only after a successful session-directory reset. Quarantine backups stay beside the session directory and are ignored by Git. Non-retryable failures stop automatic retries without deleting auth. Pairing codes are displayed only on an attached interactive terminal; Pino redacts code-bearing fields, and redirected stdout (including PM2 output) never receives the pairing value. `lib/utils/libsignal-log-dedupe.js` suppresses only a complete match for the pinned libsignal failed-session banner and exact Bad MAC stack fingerprint. It reports a neutral count and measured elapsed window without repeating stack traces or including message, sender, or key data. Its bounded buffer fails open by replaying the entire candidate batch when a limit is reached; partial, changed, or unrelated console errors and the app's reconnect, logout, and pairing logs pass through unchanged. The deduper is disposed on normal and fatal shutdown so any pending count/window summary is flushed once. The matcher intentionally depends on the upstream wording and stack fingerprint; if it changes, diagnostics are shown rather than suppressed. `handler/index.js` discovers command modules recursively, dispatches messages, applies cooldowns and rate limits, and supports command hot reload. Game and economy logic lives in `lib/game/`; `lib/database/db.js` routes persistence to the JSON adapter in `lib/database/json.js`, which uses cached collections, private temporary files, atomic replacement, and backups. Before replacing an existing collection, the adapter creates or replaces one latest backup at `${collection}.json.bak`; this is not an archive, and backups are not restored automatically. The JSON adapter assumes a single writer; it is not a multi-process lock. `webhook/trakteer.js` provides the optional donation integration.

The version-pinned `patches/@whiskeysockets+baileys+6.7.22.patch` is reapplied after installation by `patch-package`. It retries an encrypted `msg`/`pkmsg` once only when that same direct-message or group stanza supplies a valid matching PN/LID pair, uses the alternate address, preserves the original error if the retry fails, and adds no identifier-bearing retry log. This is a candidate compatibility improvement, not a confirmed cause or cure for the reported production loop: the incident excerpt did not retain the stanza's PN/LID fields, and this code is tested only with synthetic offline fixtures.

## Tests

Run the available test suites with Node's built-in test runner:

```sh
DOTENV_CONFIG_PATH=/dev/null node --test test/*.test.js
```

This covers JSON persistence, owner filemanager path/read-only behavior, WhatsApp session/reconnect reliability using synthetic temporary auth markers, synthetic libsignal Bad MAC log bursts, and the pinned Baileys PN/LID fallback. The Baileys tests cover both direct and group PN/LID directions, device-suffix normalization, absent/incomplete/mismatched pairs, primary success, other encryption types, post-decrypt parsing errors, and preservation of the original failure when the alternate also fails; they use no live identifiers, keys, auth state, or message content. The broader suite verifies transient 408 copy without logout/reset claims, explicit Baileys `CB:failure` 401 classification while preserving bare 401, success-only reset wording, single-flight backoff, failed credential/Signal-key repair before auth reload, logout priority during a close transition, actual raw-WebSocket close gating and timeout blocking, fatal-process cleanup followed by exit(1), unknown WebSocket recovery, pairing-code log redaction, sanitized persistence failures, bounded-buffer fail-open behavior, exact Bad MAC deduplication with count and elapsed-window summaries, final summary flushing on normal/fatal shutdown, and passthrough for unrelated errors, partial or changed upstream signatures, disconnects, 401/408, and pairing diagnostics. The suite uses synthetic data and does not connect to WhatsApp or access live session/auth state. There is no `npm test` script currently.

## Maintainer guidance

For every release or merged update, bump `package.json` using SemVer and keep `package-lock.json` in sync. Update this README whenever setup, configuration names, command categories/behavior, architecture, or test instructions change. Treat re-enabling any filemanager mutation as a security-sensitive change and add appropriate race-resistant path handling and tests first.
