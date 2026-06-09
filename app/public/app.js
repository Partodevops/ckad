'use strict';

/*
 * Lumen front-end. Plain browser JS — no framework, no build step.
 * It keeps a local copy of the tasks in `state`, talks to the /api routes,
 * and re-renders the list whenever something changes.
 */

/* ------------------------------- state ----------------------------------- */

// The single in-memory model the UI renders from.
const state = {
  tasks: [],            // every task, as returned by the server
  filter: 'all',        // 'all' | 'active' | 'completed'
  search: '',           // current search text
  newPriority: 'medium',// priority selected in the composer bar
};

const $ = (sel) => document.querySelector(sel); // tiny querySelector shorthand
const list = $('#list');
const RING_LEN = 326.7; // circumference of the progress ring (2π·r, r=52)

/* ------------------------------- helpers --------------------------------- */

// Coerce whatever the API gives us for a date (string or Date) into a plain
// 'YYYY-MM-DD' string, using local time so the day never shifts by a timezone.
function ymd(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

// Today as 'YYYY-MM-DD' in the user's local timezone (for overdue comparisons).
function todayYmd() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

// Turn a due date into a friendly label: Today / Tomorrow / Yesterday, a weekday
// name if it's within the coming week, otherwise a short "Mon 9"-style date.
function formatDue(ymdStr) {
  if (!ymdStr) return null;
  const [y, m, d] = ymdStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A task is overdue if it's not done and its due date is before today.
function isOverdue(t) {
  return !t.completed && t.due_date && ymd(t.due_date) < todayYmd();
}

// Show a brief message at the bottom of the screen, auto-hiding after ~2s.
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// Thin fetch wrapper: JSON in, JSON out. Throws an Error carrying the server's
// message on failure, and returns null for 204 No Content (e.g. DELETE).
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch {} // ignore non-JSON bodies
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

/* --------------------------------- icons --------------------------------- */

const ICON = {
  check: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9.3 16.2 5 11.9a1 1 0 1 0-1.4 1.4l5 5a1 1 0 0 0 1.4 0l10-10a1 1 0 1 0-1.4-1.4L9.3 16.2Z"/></svg>',
  drag: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9-14a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14.06 6.19 17.8 9.94 8.7 19.04l-3.7.4.4-3.7 8.66-9.55Zm5.66-.83-1.66-1.66a1.5 1.5 0 0 0-2.12 0l-1.3 1.3 3.78 3.78 1.3-1.3a1.5 1.5 0 0 0 0-2.12Z"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7H4a1 1 0 0 1 0-2h4V4a1 1 0 0 1 1-1Zm1 6a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Z"/></svg>',
  clock: '<svg class="ico" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10a1 1 0 0 1-.3.7l-3 3a1 1 0 1 1-1.4-1.4L11 11.6V7a1 1 0 1 1 2 0v5Z"/></svg>',
};

/* --------------------------------- render -------------------------------- */

// Apply the active filter + search to produce the tasks that should be shown.
function visibleTasks() {
  const q = state.search.toLowerCase();
  return state.tasks.filter((t) => {
    if (state.filter === 'active' && t.completed) return false;
    if (state.filter === 'completed' && !t.completed) return false;
    if (q) {
      // match against title, notes and tag together
      const hay = `${t.title} ${t.notes} ${t.tag}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Reordering only makes sense when the full, unfiltered list is on screen —
// otherwise the saved positions wouldn't match what the user sees.
function dragEnabled() {
  return state.filter === 'all' && !state.search;
}

// Rebuild the whole list from state. Cheap enough here that we don't bother
// with fine-grained DOM diffing.
function render() {
  updateStats();
  const tasks = visibleTasks();
  list.innerHTML = '';

  if (!tasks.length) {
    $('#empty').hidden = false;
    $('#empty h2').textContent = state.tasks.length ? 'No matches' : 'Nothing here yet';
    return;
  }
  $('#empty').hidden = true;

  for (const t of tasks) list.appendChild(renderTask(t));
}

// Build one <li> for a task: drag handle, checkbox, title/notes, meta pills,
// and edit/delete actions. Returns the element ready to append.
function renderTask(t) {
  const li = document.createElement('li');
  li.className = `task prio-${t.priority}` + (t.completed ? ' done' : '');
  li.dataset.id = t.id;
  if (dragEnabled()) li.draggable = true; // only allow dragging in the 'All' view

  const due = ymd(t.due_date);
  const overdue = isOverdue(t);

  // The little pills shown under the title (priority, optional tag, optional due).
  const meta = [];
  meta.push(`<span class="pill"><span class="prio-dot"></span>${t.priority[0].toUpperCase() + t.priority.slice(1)}</span>`);
  if (t.tag) meta.push(`<span class="pill pill--tag">#${escapeHtml(t.tag)}</span>`);
  if (due) meta.push(`<span class="pill pill--due ${overdue ? 'is-overdue' : ''}">${ICON.clock}${formatDue(due)}</span>`);

  li.innerHTML = `
    <span class="task__handle" title="Drag to reorder">${ICON.drag}</span>
    <button class="check" aria-label="Toggle complete">${ICON.check}</button>
    <div class="task__body">
      <div class="task__title">${escapeHtml(t.title)}</div>
      ${t.notes ? `<div class="task__notes">${escapeHtml(t.notes)}</div>` : ''}
      <div class="task__meta">${meta.join('')}</div>
    </div>
    <div class="task__actions">
      <button class="act act--edit" title="Edit">${ICON.edit}</button>
      <button class="act act--del" title="Delete">${ICON.del}</button>
    </div>`;

  // Wire up the row's buttons to their actions.
  li.querySelector('.check').addEventListener('click', () => toggleComplete(t));
  li.querySelector('.act--edit').addEventListener('click', () => openEdit(t));
  li.querySelector('.act--del').addEventListener('click', () => removeTask(t));

  return li;
}

// Escape user text before putting it in innerHTML, so a task titled "<img …>"
// can't inject markup. (Defense in depth — values are also validated server-side.)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* --------------------------------- stats --------------------------------- */

// Recompute the header numbers and the completion ring from the current tasks.
function updateStats() {
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.completed).length;
  const active = total - done;
  const overdue = state.tasks.filter(isOverdue).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  $('#statTotal').textContent = total;
  $('#statActive').textContent = active;
  $('#statDone').textContent = done;
  $('#statOverdue').textContent = overdue;

  $('#ringPct').textContent = pct + '%';
  // Draw the ring by leaving a fraction of its circumference "unfilled".
  $('#ringValue').style.strokeDashoffset = RING_LEN * (1 - pct / 100);
}

/* ------------------------------- mutations ------------------------------- */
/* Each of these calls the API, updates `state` to match, then re-renders.    */

// Initial load: pull all tasks from the server.
async function loadTasks() {
  try {
    state.tasks = await api('GET', '/api/tasks');
    render();
  } catch (e) {
    toast('Could not load tasks — is the server up?');
  }
}

// Create a task from the composer bar, then clear the inputs.
async function addTask(e) {
  e.preventDefault(); // don't let the form do a full page reload
  const title = $('#newTitle').value.trim();
  if (!title) return;
  const payload = {
    title,
    priority: state.newPriority,
    tag: $('#newTag').value.trim(),
    due_date: $('#newDue').value || null,
  };
  try {
    const created = await api('POST', '/api/tasks', payload);
    state.tasks.push(created);
    $('#newTitle').value = '';
    $('#newTag').value = '';
    $('#newDue').value = '';
    render();
  } catch (err) {
    toast(err.message);
  }
}

// Flip a task's completed flag and sync the returned row back into state.
async function toggleComplete(t) {
  try {
    const updated = await api('PATCH', `/api/tasks/${t.id}`, { completed: !t.completed });
    Object.assign(t, updated); // copy server's authoritative values onto our object
    render();
  } catch (err) {
    toast(err.message);
  }
}

// Delete a task and drop it from local state.
async function removeTask(t) {
  try {
    await api('DELETE', `/api/tasks/${t.id}`);
    state.tasks = state.tasks.filter((x) => x.id !== t.id);
    render();
    toast('Task deleted');
  } catch (err) {
    toast(err.message);
  }
}

// Read the current DOM order after a drag and persist it to the server.
async function persistOrder() {
  const ids = [...list.querySelectorAll('.task')].map((li) => Number(li.dataset.id));
  // Mirror the new order in local state so the next render keeps it.
  ids.forEach((id, idx) => {
    const t = state.tasks.find((x) => x.id === id);
    if (t) t.position = idx + 1;
  });
  state.tasks.sort((a, b) =>
    Number(a.completed) - Number(b.completed) || a.position - b.position
  );
  try {
    await api('POST', '/api/tasks/reorder', { order: ids });
  } catch (err) {
    toast('Could not save order');
  }
}

/* ------------------------------ edit dialog ------------------------------ */

let editingId = null;        // which task the modal is currently editing
const dialog = $('#editDialog');

// Populate the modal with a task's values and open it.
function openEdit(t) {
  editingId = t.id;
  $('#editTitle').value = t.title;
  $('#editNotes').value = t.notes || '';
  $('#editPriority').value = t.priority;
  $('#editTag').value = t.tag || '';
  $('#editDue').value = ymd(t.due_date) || '';
  dialog.showModal();
}

// Save handler for the edit modal: send all fields and update state on success.
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (editingId == null) return;
  const payload = {
    title: $('#editTitle').value.trim(),
    notes: $('#editNotes').value.trim(),
    priority: $('#editPriority').value,
    tag: $('#editTag').value.trim(),
    due_date: $('#editDue').value || null,
  };
  if (!payload.title) return;
  try {
    const updated = await api('PATCH', `/api/tasks/${editingId}`, payload);
    const t = state.tasks.find((x) => x.id === editingId);
    if (t) Object.assign(t, updated);
    dialog.close();
    render();
    toast('Saved');
  } catch (err) {
    toast(err.message);
  }
});
$('#editCancel').addEventListener('click', () => dialog.close());

/* ----------------------------- drag & drop ------------------------------- */
/* Native HTML5 drag-and-drop. We reorder the DOM live as you drag, then save  */
/* the resulting order on drop.                                                */

// Given the pointer's Y position, find the task the dragged item should sit
// *before* — the first one whose vertical midpoint is below the cursor.
function getDragAfter(container, y) {
  const els = [...container.querySelectorAll('.task:not(.is-dragging)')];
  let closest = { offset: -Infinity, el: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
  }
  return closest.el;
}

// Mark the card being dragged (used by getDragAfter and for the dimmed style).
list.addEventListener('dragstart', (e) => {
  const li = e.target.closest('.task');
  if (!li || !li.draggable) return;
  li.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
});

// As the pointer moves, slot the dragged card into its new position live.
list.addEventListener('dragover', (e) => {
  const dragging = list.querySelector('.is-dragging');
  if (!dragging) return;
  e.preventDefault(); // required to allow a drop
  const after = getDragAfter(list, e.clientY);
  if (after == null) list.appendChild(dragging);          // past the last card
  else if (after !== dragging) list.insertBefore(dragging, after);
});

// On release, clear the drag style and save the new order.
list.addEventListener('dragend', (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  li.classList.remove('is-dragging');
  persistOrder();
});

/* ------------------------------- controls -------------------------------- */
/* Wire up the composer, priority selector, filters and search box.           */

// Composer form → create a task.
$('#composer').addEventListener('submit', addTask);

// Priority segmented control: remember the choice and move the active highlight.
$('#prioritySeg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg__btn');
  if (!btn) return;
  state.newPriority = btn.dataset.priority;
  $('#prioritySeg').querySelectorAll('.seg__btn').forEach((b) =>
    b.classList.toggle('is-active', b === btn)
  );
});

// Filter chips: switch the active filter and re-render.
$('#filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  state.filter = btn.dataset.filter;
  $('#filters').querySelectorAll('.chip').forEach((b) =>
    b.classList.toggle('is-active', b === btn)
  );
  render();
});

// Search box, debounced ~120ms so we don't re-render on every keystroke.
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => { state.search = v; render(); }, 120);
});

/* --------------------------------- theme --------------------------------- */

// Restore the previously chosen theme (the HTML defaults to dark).
const savedTheme = localStorage.getItem('lumen-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

// Toggle button flips dark ⇆ light and remembers the choice for next time.
$('#themeToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('lumen-theme', next);
});

/* --------------------------------- boot ---------------------------------- */

// Entry point: show which storage backend is live, then load the tasks.
(async function boot() {
  try {
    const health = await api('GET', '/api/health');
    $('#storeBadge').textContent = health.storage || 'storage';
  } catch {} // footer badge is cosmetic — ignore if health check fails
  loadTasks();
})();
