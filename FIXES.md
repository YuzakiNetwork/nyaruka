# Verified Source Corrections

The attached archive already contains `readCollection`, `writeCollection`, `hasRecord`, and `config.economy`; their presence alone did not make the affected paths safe. The database router exposes collection operations asynchronously, while economy initialization and player existence checks were consuming those results synchronously. The fixes below align those call chains and record the current limits of the database layer.

## Source changes

- `lib/database/db.js` now awaits `hasRecord` and returns a boolean only after the adapter result resolves. `lib/game/player.js` and `commands/rpg/register.js` await existence checks; `createPlayer` also waits before deciding whether the record already exists.
- `lib/game/economy.js` now loads and saves collections asynchronously. The startup caller in `index.js`, economy price/trade operations, world-event reads, quest generation, and their command handlers await those APIs instead of treating a Promise as an economy object or event.
- MongoDB support has been removed entirely: JSON (`lib/database/json.js`) is the only database backend. `config.js` no longer reads any database credentials, and `.env.example` contains no database credential fields.
- Added the missing `config.cooldowns` defaults used by the shop and dungeon modules. This fixes their module-load failure while preserving the existing 3-second default when no override is set.
- Repaired a misplaced closing delimiter in `lib/game/job.js`; the existing Summoner job branch is now part of `JOB_TREE`, and the module parses.

## Checks run

- Installed declared dependencies with `npm ci --ignore-scripts --no-audit --no-fund`; `node_modules` is not included in the deliverable ZIP.
- `node --check` passed for all **79 JavaScript files** in the archive.
- Functional checks used a fresh temporary JSON database. They verified that economy startup returns a resolved object and writes the initial 27 item records; collection reads and writes round-trip; `hasRecord` returns true/false correctly; a world event can be read after save; a buy updates persisted demand; and player existence, creation, duplicate rejection, and the registration command's duplicate check behave as expected.
- A JSON-mode startup preflight passed through `initDatabase`, awaited `loadEconomy`, and command discovery: **51 commands loaded, 0 import failures**. It stopped before starting a WhatsApp socket or attempting login/pairing. It therefore verifies the database/economy/command-loading startup path, not a live WhatsApp session or the full `index.js` network lifecycle.

## MongoDB status

The MongoDB adapter (`lib/database/mongodb.js`), the `scripts/migrate-to-mongo.js` migration tool, the `mongodb` npm dependency, and all related configuration (`DB_TYPE`, `MONGO_URI`, `MONGO_DB`) have been removed from the codebase. JSON file storage (`lib/database/json.js`) is now the only available database backend and the only one ever verified end-to-end. Any future database backend (e.g. Postgres/Supabase) will be added through the existing router in `lib/database/db.js`.
