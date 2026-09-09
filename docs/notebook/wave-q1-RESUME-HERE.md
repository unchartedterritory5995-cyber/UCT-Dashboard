# Wave Q1 — RESUME HERE

**Written 2026-09-09 before a machine restart.** Everything below is committed
and pushed; nothing is held in a session, a browser tab, or a running process.

---

## The one decision waiting for you

**Do we flip `OFFLINE_DEFAULT_ON` to `true` now, or fix the empty-snapshot
defect first?**

The last directive (§18/§24) says activation is blocked *only* on harness
integrity, and harness integrity is now **green**. But the activation canary that
went red on 2026-09-09 was a **different** defect, against production, untouched
by the harness work — and its root cause is still unknown.

- **Flip now** → members get offline Notebook editing, and are exposed to a path
  that can queue a note write with `baseUpdatedAt: null`, i.e. a PUT with **no
  compare-and-set**. On a note with real prose that replaces it with an empty
  document.
- **Fix first** (my recommendation) → build the note-load reproduction, fix, then
  run the §15 canary again and activate.

⛔ **I have not flipped it.** Production is dark and verified.

---

## Where everything stands

| | state |
|---|---|
| Q1 implementation | **built, railed, merged to master — and INERT** |
| `OFFLINE_DEFAULT_ON` | **`false`** (verified on master and on the deployed artifact) |
| §32 browser matrix | **complete and green**, incl. Safari on two real iPhones |
| Activation | attempted 16:05 UTC, **rolled back 16:20 UTC** — canary red |
| Harness integrity | **green** — identity, ports, controls, mutation-proved |
| Q2 | **locked** |
| Service worker | untouched, and stays untouched |

Last Wave Q commit: **`bd3259aff`**. Branch `notebook-primary-platform`, worktree
`C:\Users\Patrick\uct-worktrees\notebook-primary-platform`.

Production check, any time:

```bash
curl -s -H "User-Agent: Mozilla/5.0 Chrome/152" https://uctintelligence.com/api/health
git show origin/master:app/src/pages/journal-2-0/lib/offline/offlineFlag.js | grep OFFLINE_DEFAULT_ON
```

In a signed-in browser console, the live dark proof — **no lock claimed** is the
whole check:

```js
const q = await navigator.locks.query()
;[...q.held, ...q.pending].filter(l => String(l.name).startsWith('uct.nb.sync.'))   // → []
```

---

## The open defect, in full

**Symptom.** During the §15 canary, after a reload of a note that had unsynced
work, all three local layers held an **empty note**, and the outbox queued that
empty state with `baseUpdatedAt: null`.

```
notes  { title:"", subtitle:"", bodyJson:{doc,[paragraph]}, dirty:1,
         generation:1, sessionId:<new>, baseUpdatedAt:null }
outbox { patch:{ title:"", subtitle:"", bodyJson:{doc,[paragraph]} },
         baseUpdatedAt:null, permanent:false }
draft  { title:"", subtitle:"", bodyJson:{doc,[paragraph]} }
```

**Certain from the artifact:** `generation: 1` (first schedule of that page
session), fresh `sessionId`, null baseline ⇒ the snapshot was scheduled **before
the note finished loading**. `scheduleAutosave` therefore ran, so TipTap's
`onUpdate` fired on an empty editor.

**⛔ Root cause NOT established. Two reproductions failed:**

1. re-opening the same note in production with the flag on → **nothing written at
   all** (no draft, no record, no outbox entry);
2. a jsdom mount of `NoteEditorPage` with `useJ2Note` returning `note: null`
   first → also nothing written.

**Leading hypothesis, unproven:** a slow note fetch widens the window in which
`useEditor(..., [note?.id])` has been constructed with `{type:'doc',content:[]}`
before `note` arrives. The pod was two minutes old during the canary.

**⚠️ The asymmetry to keep in view while diagnosing:** the server save is
debounced 800 ms and reads title/body **fresh at fire time**; the durable write
is debounced ~200 ms and persists a **schedule-time snapshot**. Anything that
fires early reaches the durable layer and never reaches the network layer. That
is why this was benign for years as a localStorage-only bug and became
dangerous the moment Q1 attached a queued server mutation to it.

**Certain regardless of trigger:** a queued write with `baseUpdatedAt: null` for
a note that has a server revision cannot prove it is not clobbering, and
`sendNoteUpdate` omits the field when falsy. **It must never be sent.** Fixable
on its own merits, today, without knowing the trigger.

Full write-up: `wave-q1-activation-canary-red.md`.

---

## If the answer is "fix it"

1. **Reproduce first.** A harness that delays the `useJ2Note` fetch (or a
   Playwright route-interception delaying `GET /api/j2/notes/{id}`) so the
   empty-editor window is wide and observable. **No fix lands before the trigger
   is a measurement** — I already had a mechanism written and had to delete it.
2. Gate `scheduleAutosave` on a `hydratedRef` set once the note-load effect has
   put server content into the editor and the refs. This also kills the
   long-standing empty-`localStorage`-draft bug.
3. Make the drain refuse a null-baseline entry: keep the work, stop retrying,
   surface it — the same posture as `permanent`.
4. Rails: the reproduction itself, plus "`sendNoteUpdate` never PUTs without
   `baseUpdatedAt` when the note has a server revision". Mutation-check both.
5. Then the §15 canary again, then activate.

## If the answer is "flip it anyway"

The already-approved sequence: flip (one variable, nothing else in that commit) →
verify on the deployed artifact (the lock query above should now return one held
lock) → §15 happy-path canary → conflict canary → clean up canonically → start
the seven-day observation in `wave-q1-observation-window.md`.

---

## Traps that have already cost time here

- ⛔ **Never put `\n` or other escapes through a Bash heredoc.** It has silently
  become a literal newline three times — once shipping a SyntaxError to
  production in the probe page, which rendered perfectly and measured nothing.
  Use the Edit/Write tool for anything containing escapes.
- ⛔ **A port is not a server identity.** `python tools/q1_browser_probe_run.py
  --self-check` before trusting any local or tunnelled run. Port **8099 belongs
  to the hub sandbox** (`scripts/hub_sandbox_boot.py`, another workstream) — it
  will not survive the restart, and restarting it is *their* call, not ours.
- ⛔ **`vitest` must run from `app/`.** Backend tests from the repo root.
- ⛔ **`reachable.test.js` is RED on master** for 19 modules under
  `pages/community`, `floor2` and friends — inherited from the `/community`
  redesign swap. Routed, not ours, and repo-green must not be claimed.
- ⛔ Deploys take 5–12 minutes and `master` **is** production. Verify by the
  artifact (`/api/health` uptime reset), never by the source default.

---

## Quick orientation for a fresh session

```
app/src/pages/journal-2-0/lib/offline/     the wave: notebookDb · durableWriter ·
                                           recoverLocalState · outboxLeader ·
                                           outboxDrain · useDurableNote ·
                                           useOutboxDrain · offlineFlag
app/public/q1-probe.html                   the browser certification instrument
tools/q1_probe_server.py                   identity-verifying local server
tools/q1_browser_probe_run.py              runner (--serve / --self-check / --url)
docs/notebook/wave-q1-*.md                 certification · canary-red · harness ·
                                           observation-window · this file
```

Memory: `project_notebook_wave_q_offline_2026_09_09` (open it before acting).
