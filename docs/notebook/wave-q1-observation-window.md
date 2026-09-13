# Wave Q1 — the seven-day production observation window

> ⚰️ **SUPERSEDED 2026-09-12 — Q1 IS NOT ACTIVE.** This header said *"Q1 is ACTIVE in
> production, `OFFLINE_DEFAULT_ON = true` as of 2026-09-09"*. It was rolled back that
> same day (`ee952041c`) and has been `false` ever since, on the branch, on `master`
> and on the live bundle. The window below has **never run**; it describes the week of
> watching that starts *if* the flip is approved.
> This is the first durable client-side member research state in the Notebook's
> history, so it gets an isolated week of watching before anything else moves.
>
> ⛔ **Q2 IS LOCKED UNTIL THIS WINDOW CLOSES.** No expanded conflict UX, no
> attachment caching, no offline search, no service worker, no finance-native
> offline writes. Introducing new offline semantics while measuring the
> foundation would contaminate the only clean read we will ever get of it.

**Window:** 2026-09-09 → 2026-09-16.

---

## ⛔⛔ THE DENOMINATOR WAS REDEFINED AT THE FLIP — read this before reading any zero

`notebook_offline_opt_in` is what makes "zero `notebook_blocked_no_baseline`
events" mean anything: a week of zeros over **zero** browsers running the layer
is not evidence, it is an empty set.

⚰️ **Until 2026-09-12 it fired when the localStorage key BECAME `'1'`.** After
the flip the key is **unset** for every member and the layer is **on** — so that
condition is false for the entire population. The denominator would have sat at
zero while the numerator was drawn from everybody. ⛔ **A zero denominator does
not read as broken. It reads as healthy**, which is the more dangerous failure,
and it is the same shape as a green browser matrix over a mount path nobody
covered — the error that gave this wave its incident.

**It now fires when the LAYER IS ACTIVE** (`offlineEnabled()` — the same reader
the editor and the drain gate on), so the denominator counts exactly the
population the numerator comes from. `api/routers/journal_two.py` still lists
the event in `_J2_TELEMETRY_EVENTS`; this file, not that comment, is where the
definition lives.

⭐ **And the dedupe marker had to change with it.** It mirrored the key and
REMOVED itself when the key was unset — harmless while unset meant OFF; once
unset means ON it clears the dedupe every load and turns a once-per-BROWSER
count into a once-per-PAGE-VIEW count. It now stores the RESOLVED state.

**What the table should look like:** roughly **one event per member browser, on
that browser's first Notebook load after it picks up the new bundle**. There is
no version prompt and no service worker, so it arrives as a trickle over hours
and days as members reload — never a spike at merge. `byDefault: true` on
essentially all of them; `byDefault: false` only where someone set `'1'` by hand
(the rig). A count that climbs faster than distinct browsers, or that keeps
climbing with no new members, means the dedupe regressed.

## What to watch (§18)

| # | Signal | Why it matters | Where it shows |
|---|---|---|---|
| A | `(conflicted copy)` notes created | The headline number — but the COUNT is not the finding. Each one must be classified: a genuine concurrent edit, a false conflict, a stale-base bug, or a recovery/restore artifact. A single-device member should produce approximately none. | notes tagged `sync-conflict`; creation timestamps |
| B | `permanent: true` outbox entries | An entry that can never send, holding member work. **Highest priority.** | `outbox` store, `permanent` / `lastStatus` |
| C | Stuck outbox entries | Queued and not moving. Waiting indefinitely is not acceptable. | `queuedAt` age vs now |
| D | Repeated CAS (409) failures | A baseline that keeps going stale points at the write path, not at the member. | server 409s on `PUT /api/j2/notes/{id}` |
| E | Web Locks ownership anomalies | Two leaders, or none. Either breaks the single-drainer contract. | `navigator.locks.query()` on `uct.nb.sync.*` |
| F | Duplicate conflict forks | The same local version forked twice means the fork path is not idempotent. | duplicate `(conflicted copy)` titles |
| G | Local restore mismatches | The recovery banner offering the wrong copy — the failure `chooseLocalRecovery` exists to prevent. | member reports; `ambiguous: true` decisions |
| H | Logout with unsynced work | The case where "discard" has to be honest. | (no logout flow shipped in Q1 — watch for the need) |
| I | Local persistence / quota errors | `durableWriter` status `FAILED`. | writer status, `error` |
| J | Cross-account database anomalies | **A release blocker if it ever appears.** The account is part of the database NAME, so a leak would mean a name was built wrong. | `indexedDB.databases()` → `uct_notebook_*` |

## ⛔ Watch state, not content (§19)

Everything above is answerable from **note id, queue age, record state, retry
count, conflict presence, account-scoped counts, error class and lock state**.

⛔ **Do not read or log member note bodies to monitor this wave.** Member
research is private, and the operational fields are sufficient. If a question
genuinely cannot be answered without content, that is a finding about the
instrumentation — write it down instead of reaching for the prose.

## How to look, without disturbing anything

In a signed-in browser's console, on `uctintelligence.com`:

```js
// state only — no bodies
const acc = '<accountId>'
const db = await new Promise(r => { const q = indexedDB.open('uct_notebook_' + acc); q.onsuccess = () => r(q.result) })
const all = s => new Promise(r => { const q = db.transaction(s, 'readonly').objectStore(s).getAll(); q.onsuccess = () => r(q.result) })
const notes = await all('notes'), outbox = await all('outbox'), conflicts = await all('conflicts')
console.table(outbox.map(e => ({ noteId: e.noteId, ageMin: Math.round((Date.now() - e.queuedAt) / 60000),
                                 permanent: !!e.permanent, lastStatus: e.lastStatus ?? null, attempts: e.attempts ?? 0 })))
console.log({ notes: notes.length, dirty: notes.filter(n => n.dirty).length, conflicts: conflicts.length })
db.close()
const locks = await navigator.locks.query()
console.log([...locks.held, ...locks.pending].filter(l => String(l.name).startsWith('uct.nb.sync.')))
```

Server-side, conflicted copies are ordinary notes tagged `sync-conflict`, so they
are countable from the notes list without touching bodies.

---

## Rollback (§20, §21)

**One line:** `OFFLINE_DEFAULT_ON` back to `false`, or per browser with no deploy
at all: `localStorage.setItem('uct.j2.offline.enabled', '0')`.

⛔ **Turning it off stops PROCESSING. It does not delete anything.** With the
wave off:

- the editor writes nothing new and leaves any durable copy and its queued
  intent byte for byte where they are, saving to the server exactly as it did
  before Wave Q1;
- the drain claims no leadership — not even a queued lock request — and sends
  nothing;
- a later re-enable picks the queue back up.

Both halves are railed and mutation-proved (`NoteEditorPage.durable.test.jsx`
§21 and `useOutboxDrain.test.jsx` §21). **Feature disable has never been
authority over member work**, and that matters now in a way it did not before
activation.

If a material issue appears: **flag off first**, preserve the local state, then
diagnose.

---

## What closes the window (§28)

A Q1 production reliability report covering: accounts exercising Q1 where
measurable · notes edited offline · outbox writes · successful drains · retry
counts · conflicts, split into true vs false where classifiable · permanent
failures · stuck queues · lock anomalies · persistence/quota failures ·
logout-with-unsynced cases · rollback events, if any · production browser
issues.

Then **STOP for Q2 authorization.** Q2 does not begin automatically.
