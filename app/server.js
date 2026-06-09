'use strict';

// Lumen's HTTP layer: a small Express app that serves the static UI from
// /public and exposes a JSON API under /api. All data access goes through db.js.

const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // parse JSON request bodies into req.body
app.use(express.static(path.join(__dirname, 'public'))); // serve index.html, css, js

// Allowed priority values — used to validate input and reject anything else.
const PRIORITIES = new Set(['low', 'medium', 'high']);

// Normalize and sanitize an incoming task body so bad/oversized input can't
// reach the database: trim strings, cap tag length, fall back to safe defaults,
// and only accept a strict YYYY-MM-DD due date (everything else becomes null).
function cleanTask(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const tag = typeof body.tag === 'string' ? body.tag.trim().slice(0, 24) : '';
  const priority = PRIORITIES.has(body.priority) ? body.priority : 'medium';
  const due_date =
    body.due_date && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date)
      ? body.due_date
      : null;
  return { title, notes, tag, priority, due_date };
}

/* ----------------------------- routes ----------------------------- */

// Liveness probe + which storage backend is active (used by the UI footer).
app.get('/api/health', (_req, res) => res.json({ ok: true, storage: db.mode }));

// List every task. Incomplete tasks come first, then by manual drag order,
// then by creation time as a stable tie-breaker.
app.get('/api/tasks', async (_req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM tasks
       ORDER BY completed ASC, position ASC, created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err); // hand off to the error handler at the bottom
  }
});

// Create a task. New tasks are appended to the end by giving them a position
// one greater than the current maximum (COALESCE handles the empty-table case).
app.post('/api/tasks', async (req, res, next) => {
  try {
    const t = cleanTask(req.body);
    if (!t.title) {
      return res.status(400).json({ error: 'A task needs a title.' });
    }
    const { rows } = await db.query(
      `INSERT INTO tasks (title, notes, priority, tag, due_date, position)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE((SELECT MAX(position) FROM tasks), 0) + 1)
       RETURNING *`,
      [t.title, t.notes, t.priority, t.tag, t.due_date]
    );
    res.status(201).json(rows[0]); // 201 Created + the new row
  } catch (err) {
    next(err);
  }
});

// Partially update a task. Only the fields present in the body are touched, so
// the SET clause and its parameters are built dynamically ($1, $2, … then the id).
app.patch('/api/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });

    const sets = []; // SQL fragments like "title = $1"
    const vals = []; // matching values, in the same order
    let i = 1;       // current placeholder number
    const b = req.body || {};

    if (typeof b.title === 'string') {
      const title = b.title.trim();
      if (!title) return res.status(400).json({ error: 'Title cannot be empty.' });
      sets.push(`title = $${i++}`); vals.push(title);
    }
    if (typeof b.notes === 'string') { sets.push(`notes = $${i++}`); vals.push(b.notes.trim()); }
    if (typeof b.tag === 'string') { sets.push(`tag = $${i++}`); vals.push(b.tag.trim().slice(0, 24)); }
    if (PRIORITIES.has(b.priority)) { sets.push(`priority = $${i++}`); vals.push(b.priority); }
    if (b.due_date === null || /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '')) {
      sets.push(`due_date = $${i++}`); vals.push(b.due_date || null);
    }
    if (typeof b.completed === 'boolean') { sets.push(`completed = $${i++}`); vals.push(b.completed); }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });

    vals.push(id); // the id is the last parameter, used in the WHERE clause
    const { rows } = await db.query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Persist a new drag order. The client sends the task ids top-to-bottom; we
// write 1, 2, 3, … into each row's `position` so the order survives a reload.
app.post('/api/tasks/reorder', async (req, res, next) => {
  try {
    const order = Array.isArray(req.body.order) ? req.body.order : [];
    let pos = 1;
    for (const rawId of order) {
      const id = Number(rawId);
      if (!Number.isInteger(id)) continue; // skip anything that isn't a real id
      await db.query('UPDATE tasks SET position = $1 WHERE id = $2', [pos++, id]);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Delete a task. Responds 204 No Content whether or not the row existed.
app.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
    await db.query('DELETE FROM tasks WHERE id = $1', [id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/* --------------------------- error handler ------------------------ */

// Any error passed to next(err) lands here. We log the real cause server-side
// but only return a generic message so internals never leak to the client.
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/* ------------------------------ boot ------------------------------ */

// Connect to the database first, then start accepting HTTP requests. If the DB
// can't be reached we exit non-zero so Docker can restart the container.
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Lumen is running → http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('[fatal] could not start Lumen:', err);
    process.exit(1);
  });
