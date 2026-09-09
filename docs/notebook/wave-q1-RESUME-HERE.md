# Wave Q1 — RESUME HERE

**Written 2026-09-09 before a machine restart. UPDATED 2026-09-09 after the
defect was reproduced and fixed (`4fef130d9`, branch pushed, NOT on master).**
Everything below is committed; nothing is held in a session, a browser tab, or a
running process.

---

## ✅ THE DEFECT IS REPRODUCED AND FIXED — the decision has moved

The empty-snapshot defect is no longer a hypothesis. It reproduces
deterministically, the fix is in, and every rail is mutation-proved. **What is
still yours is the activation itself.**

**The trigger, measured.** TipTap's `onUpdate` is not "the member typed" — it is
"the document changed", and a document changes with no member the moment an
editor is constructed with an EMPTY doc: `{type:'doc',content:[]}` violates the
schema's `block+`, so ProseMirror appends a repair transaction inserting an empty
paragraph, **synchronously, inside `new Editor(...)`**. Measured both ways: an
editor built with content emits ZERO updates, one built empty emits exactly one,
and `getJSON()` is then `{doc,[paragraph]}` — the canary's body, exactly.

`useEditor` is keyed on `[note?.id]`, so it **rebuilds** when the note arrives —
and rebuilds **empty** whenever the server's copy of that note is empty. That is
precisely a note typed into and reloaded before its PUT landed: the server still
holds `{title:"", subtitle:"", bodyJson:{doc,[]}}`. The rebuild runs inside
`useEditor`'s own effect, ahead of the effects that mark the note loaded, so the
autosave path ran with pre-load refs and wrote an empty note to all three layers.

⛔ **One field is NOT reproduced and is not claimed:** the canary's
`baseUpdatedAt: null`. The reproduction carries the note's real baseline; every
other field matches. `j2_notes.updated_at` is `NOT NULL`, so a loaded note cannot
yield a null baseline — which means the write-up's "scheduled before the note
finished loading" reading explains the empty CONTENT but not that field. **The
trigger class is settled. That one field is still open**, and the drain-side
refusal below is what makes it harmless either way.

**Fixed in `4fef130d9`:**

1. **`hydratedRef` gates `scheduleAutosave`** before it touches the status, the
   draft, the durable copy or the save timer — the one place that can tell "the
   document changed because a person changed it" from "…because it was
   constructed". Also closes the long-standing empty-`localStorage`-draft bug
   that predates Wave Q1.
2. **`setContent(body, false)` STOPPED SUPPRESSING `onUpdate` AT TIPTAP v3** and
   said nothing. In v2 the second argument WAS `emitUpdate`; in v3 it is an
   options object destructured as `{ emitUpdate = true, … } = {}`, so a bare
   `false` leaves it **true**. Four call sites carried comments asserting
   suppression; three of them are where this page puts the CANONICAL copy on
   screen (note load, draft restore, conflict reconcile), so each had been
   autosaving content the server had just handed us. All four now pass the named
   `EMIT_NOTHING`.
3. **The drain refuses a baseline-less entry** — blocked, not deleted, not
   retried, the same posture as `permanent`. Defence in depth, and the reason the
   unexplained `null` above is no longer dangerous.

**Rails:** `NoteEditorPage.slowload.test.jsx` (the reproduction, with a slow
fetch the test controls) · `setContentEmitsUpdate.test.js` (the TipTap contract
AND a source sweep) · four new `outboxDrain` rails. Three mutations run, each
red, controls green.

⛔ **`OFFLINE_DEFAULT_ON` is untouched and still `false`.** Production is dark
and verified.

## The one decision still waiting for you

**Run the §15 canary again and activate?** The defect that stopped the last
attempt is fixed and railed; the harness gate is closed; the §32 matrix is green.
What has NOT happened is a fresh canary against production with the fix
deployed — and this branch is not on `master`, so nothing has shipped.

Sequence, unchanged from below: deploy the fix (branch → master) → §15 happy path
→ §15 conflict path → then, separately, the one-line flip.

---

## Where everything stands

| | state |
|---|---|
| Q1 implementation | **built, railed, merged to master — and INERT** |
| `OFFLINE_DEFAULT_ON` | **`false`** (verified on master and on the deployed artifact) |
| §32 browser matrix | **complete and green**, incl. Safari on two real iPhones |
| Activation | attempted 16:05 UTC, **rolled back 16:20 UTC** — canary red |
| The canary defect | **reproduced, fixed, mutation-proved** (`4fef130d9`) |
| That fix | **on the branch, NOT on master** — it has not deployed |
| Harness integrity | **green** — identity, ports, controls, mutation-proved |
| Q2 | **locked** |
| Service worker | untouched, and stays untouched |

Last Wave Q commit: **`4fef130d9`** (pushed to `origin/notebook-primary-platform`;
`origin/master` is still at `78ac8016b`). Branch `notebook-primary-platform`,
worktree `C:\Users\Patrick\uct-worktrees\notebook-primary-platform`.

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

## The open defect, in full — ✅ NOW REPRODUCED AND FIXED (`4fef130d9`)

> Everything below is the state as first written, kept because it is the record
> of what was known before the reproduction. Read the section at the top for what
> it turned out to be. The leading hypothesis recorded here — a slow fetch
> widening the empty-editor window — was **tested and is not the mechanism**: a
> slow fetch alone writes nothing. The mechanism is the editor REBUILD when the
> note arrives, and it only fires when the server's copy of that note is empty.

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

## If the answer is "fix it" — ✅ DONE, steps 1-4 (`4fef130d9`)

> Step 1 (reproduce first) was honoured: `NoteEditorPage.slowload.test.jsx`
> drives the real page with a note fetch that resolves on a timer the test
> controls, and the fix landed only after the artifact was on screen. Steps 2, 3
> and 4 are in. **Step 5 — the §15 canary, then activation — is what remains,
> and it needs the fix deployed first.**

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
- ⛔ **EIGHT files fail the full frontend suite on master, and none are ours.**
  Measured 2026-09-09: `screener/reachable.test.js` (19 modules under
  `pages/community`, `floor2`) · `__tests__/sourcesAreText.test.js`
  (`optionsFlow/wiring.guard.test.js`, a `0x08` byte) · `styles/tapFloor.test.js`
  (`notebook/CaptureDialog.module.css`, last touched by Wave L) ·
  `hooks/pollingSites.rail.test.js` · `chart/engine/ast/manifestProse.test.js`
  (`_session`) · `chart/engine/ast/pine.*` · `ThemeTrackerPage.chartmount.test.jsx`
  · one more under `components/chart/`. **Repo-green must never be claimed.**
  ⛔ Answer "did my change cause this?" with `git show <sha>:<file>`, never
  `git status` — the tapFloor offender sits inside `journal-2-0` and is still not
  ours. `journal-2-0` alone: 227 files / 2365 tests green.
- ⛔ **A rail can be green alone and red in company.** Both new rail files were
  re-checked inside the full 1,171-file run, not just on their own.
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
