-- Lumen schema. Runs automatically the first time the Postgres volume is
-- created (mounted into /docker-entrypoint-initdb.d). The app also runs
-- CREATE TABLE IF NOT EXISTS on boot, so this is belt-and-suspenders.

CREATE TABLE IF NOT EXISTS tasks (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  priority   TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  tag        TEXT NOT NULL DEFAULT '',
  due_date   DATE,
  completed  BOOLEAN NOT NULL DEFAULT false,
  position   DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_order_idx ON tasks (completed, position);
