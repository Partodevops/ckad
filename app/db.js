'use strict';

/**
 * Database layer for Lumen.
 *
 * Two interchangeable backends, same SQL:
 *   - Default: real PostgreSQL via `pg` (used by Docker / production).
 *   - Dev:     in-memory Postgres via `pg-mem` when started with `--mem`
 *              or USE_PG_MEM=1. Lets you run the app with zero install.
 *
 * Everything else in the app talks to `query()` and never cares which one
 * is active.
 */

// Pick the storage backend. `--mem` (or USE_PG_MEM) opts into the in-memory
// database; anything else uses the real Postgres connection.
const useMem =
  process.argv.includes('--mem') ||
  process.env.USE_PG_MEM === '1' ||
  process.env.USE_PG_MEM === 'true';

// Human-readable label surfaced via /api/health and shown in the UI footer.
const mode = useMem ? 'in-memory (dev)' : 'PostgreSQL';

// The one source of truth for the table shape. `IF NOT EXISTS` makes it safe to
// run on every boot — it only creates the table the first time.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id         SERIAL PRIMARY KEY,             -- auto-incrementing id
  title      TEXT NOT NULL,                  -- the task text (required)
  notes      TEXT NOT NULL DEFAULT '',       -- optional longer description
  priority   TEXT NOT NULL DEFAULT 'medium', -- 'low' | 'medium' | 'high'
  tag        TEXT NOT NULL DEFAULT '',       -- a single short label
  due_date   DATE,                           -- optional, NULL = no due date
  completed  BOOLEAN NOT NULL DEFAULT false,
  position   DOUBLE PRECISION NOT NULL DEFAULT 0, -- manual drag-sort order
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Starter tasks inserted only when the table is empty (first run / fresh volume),
// so the dashboard never opens to a blank screen. `due` is a day offset from
// today: 0 = today, 1 = tomorrow, -1 = yesterday, null = no due date.
const SEED = [
  { title: 'Welcome to Lumen ✨ — click the circle to complete a task', priority: 'high', tag: 'start', notes: 'Everything here is stored in Postgres.', due: 0 },
  { title: 'Drag a card by its handle to reorder your day', priority: 'medium', tag: 'tips', notes: '', due: 1 },
  { title: 'Add your own task using the bar above', priority: 'medium', tag: 'tips', notes: '', due: 2 },
  { title: 'Try the light / dark theme toggle, top-right', priority: 'low', tag: 'tips', notes: '', due: null },
  { title: 'Review the weekly plan', priority: 'high', tag: 'work', notes: 'Skim the backlog and pick three things.', due: -1, done: true },
];

// The active connection pool. Both pg and pg-mem expose the same `.query()`
// interface, so the rest of the file is backend-agnostic.
let backend = null;

// Connect, ensure the schema exists, and seed if needed. Called once at boot.
async function init() {
  if (useMem) {
    const { newDb } = require('pg-mem');
    const mem = newDb({ autoCreateForeignKeyIndices: true });
    // pg-mem ships a now() but registering a stable one keeps DATE defaults happy.
    const { Pool } = mem.adapters.createPg();
    backend = new Pool();
    console.log('[db] using in-memory Postgres (pg-mem) — dev mode');
  } else {
    const pg = require('pg');
    // Return DATE (oid 1082) as a plain 'YYYY-MM-DD' string, not a JS Date,
    // so days never shift across timezones on the way to the browser.
    pg.types.setTypeParser(1082, (v) => v);
    const { Pool } = pg;
    backend = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgres://lumen:lumen@localhost:5432/lumen',
      max: 10,
    });
    await waitForPostgres();
    console.log('[db] connected to PostgreSQL');
  }

  await backend.query(SCHEMA);
  await seedIfEmpty();
}

// In Docker the web container can start before Postgres is ready to accept
// connections, so we poll with a simple `SELECT 1` until it answers (or give up).
async function waitForPostgres(retries = 30, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await backend.query('SELECT 1'); // cheapest possible "are you alive?" query
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(
        `[db] waiting for Postgres (attempt ${attempt}/${retries})...`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// Insert the starter tasks, but only into an empty table so we never duplicate
// them or clobber a user's real data.
async function seedIfEmpty() {
  const { rows } = await backend.query('SELECT COUNT(*)::int AS n FROM tasks');
  if (rows[0].n > 0) return; // already has data — leave it alone

  let position = 1; // keeps the seed tasks in the order they're listed above
  for (const t of SEED) {
    // Turn the day offset into a concrete 'YYYY-MM-DD' string (86400000 ms = 1 day).
    const due =
      t.due === null || t.due === undefined
        ? null
        : new Date(Date.now() + t.due * 86400000).toISOString().slice(0, 10);
    await backend.query(
      `INSERT INTO tasks (title, notes, priority, tag, due_date, completed, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t.title, t.notes || '', t.priority, t.tag || '', due, !!t.done, position++]
    );
  }
  console.log(`[db] seeded ${SEED.length} starter tasks`);
}

// The single funnel every route uses to talk to the database. `params` are
// passed separately ($1, $2, …) so values are always safely parameterized.
function query(text, params) {
  return backend.query(text, params);
}

module.exports = { init, query, mode };
