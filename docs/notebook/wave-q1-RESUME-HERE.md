# Wave Q1 — RESUME HERE

**Written 2026-09-09 before a machine restart. UPDATED 2026-09-09 (twice): once
after the defect was reproduced and fixed in `4fef130d9`, then again after the
`baseUpdatedAt: null` question was run to ground and the deploy packet written.**
Everything below is committed to the branch; **nothing is on `master`**, and
nothing is held in a session, a browser tab, or a running process.

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
other field matches. See the section below for what was hunted and ruled out.

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

## ⚰️ `baseUpdatedAt: null` — HUNTED, NOT REPRODUCED (2026-09-09)

**It is not closed, and I am not closing it with a story.** What follows is what
was tested and what it said. Every producer of an outbox baseline was enumerated
mechanically (`grep` on every write of the field), not guessed at — there are
exactly two, and both read `lastSavedRef.current.updatedAt`.

| candidate | how it was tested | result |
|---|---|---|
| Capture before the note is hydrated | `NoteEditorPage.slowload.test.jsx` | ⭐ **This is the empty-CONTENT defect** — reproduced and fixed. But it yields the note's **real** baseline, not null. |
| `markSynced` when the PUT acks with **no** `updatedAt` | drove the real page; member types during the in-flight PUT | ❌ no null — `commitSave` falls back |
| `markSynced` when the PUT acks with an **EMPTY** `updatedAt` | same | ⚠️⚠️ **FOUND A SECOND DEFECT** — queued `baseUpdatedAt: ""`, which the sender drops. See below. Now fixed. |
| The **server** hands over a note with no usable `updatedAt` | `tests/test_note_updated_at_is_always_a_baseline.py` — 14 rails over create / empty-body create / read-back / update / CAS-update / import / restore / folder-move, plus `_import_date` against `""`, `"   "`, `None`, `12345`, `"0000-00-00"` | ❌ **impossible** — every writer emits a real timestamp. Mutation-proved twice: serializer → `""` reddens 7; `_import_date` returning its input reddens 1. |
| …but **if it ever did**, what does the editor do? | `NoteEditorPage.nullbaseline.test.jsx` | ⚠️ **it queues `baseUpdatedAt: null`.** Measured, stated, not "fixed" on a hypothesis. For a note with no baseline anywhere, null is the truth; what matters is that it is **never sent**, and that is railed. |
| Cross-note contamination (note A's refs, note B's id) | read the single mount site | ❌ structurally impossible — `NotebookTab` renders `<NoteEditorPage key={noteId}>`, so switching notes **remounts** |
| Reopen on top of a previous session's unsynced work (§15 step 9's real shape) | seeded a dirty record + queued entry from a prior session, then mounted | ❌ no new entry — the inherited one survives untouched, with its own `generation`/`sessionId` |
| An inherited entry that already has a null baseline | same fixture, drained | ✅ **blocked, never sent, every word kept** |
| Migration / older outbox schema | the store shipped at `DB_VERSION = 1` with Q1 and was live for 15 minutes | ❌ no older shape exists |

### ⚰️⚰️ AND THE HUNT FOUND A SECOND REAL DEFECT — `??` vs truthiness

**The baseline was CHOSEN with `??` in eight places and CONSUMED with
truthiness in three.** `??` falls back only on `null`/`undefined`, so an **empty
string survived as a baseline** and was then silently dropped at send time —
a PUT with **no compare-and-set**, which is the canary's exact failure mode
arriving by a different road.

```
producers:  saved?.updatedAt ?? entry.baseUpdatedAt ?? null      // nullish
consumers:  ...(entry.baseUpdatedAt ? { baseUpdatedAt } : {})    // truthy
```

⛔ The worst site was `commitSave`: `saved?.updatedAt ?? lastSavedRef.current.updatedAt`.
An ack carrying `''` **overwrites a perfectly good baseline**, so every later
save in that session goes out unguarded too.

⭐ **How it was found, and why it nearly was not.** `NoteEditorPage.nullbaseline.test.jsx`
drove the real page with a PUT that acks `updatedAt: ''` while the member keeps
typing, and read `baseUpdatedAt: ""` back out of the outbox. It **passed in
isolation and failed in the full suite** — the ordering of the ~200 ms coalescing
durable write against `markSynced` decides which value lands, so it flips under
load. An intermittent red that was a real ordering-dependent defect, not a flaky
test (`lesson_a_rail_can_be_green_alone_and_red_in_company`).

**Fixed** by `lib/offline/baseline.js` — ONE authority, `usableBaseline()`, used
at every choice; eight copies of the same coalescing cannot be mutation-proved
(`lesson_a_guard_repeated_is_a_guard_unproved`). Railed in `baseline.test.js`
with a source sweep that fails on any `??` over a baseline anywhere in the wave;
mutation-proved (revert it to nullish → 5 red across 3 files).

⛔ **This still does not explain the canary**, which showed `null`, not `''`, and
the server cannot emit `''` either. It is a second road to the same cliff, closed.

**What that leaves.** The canary's artifact says `generation: 1`, a fresh
`sessionId`, and a null baseline — i.e. the write happened **after** the reload
but **before** the note-load effect set the baseline. Every reproduction of that
ordering, with and without the fix, yields the note's real baseline instead. I
could not construct the null from any live path.

⛔ **So it is recorded as unexplained, and made harmless three ways:** the source
gate (`hydratedRef`), the server guarantee (railed), and the drain refusal
(mutation-proved). If a null baseline ever appears again in a canary artifact,
that is a genuine new finding — say so loudly rather than assuming it is this.

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

### The SHAs — two different facts, both stated on purpose

| | |
|---|---|
| **Fix commit #1** | **`4fef130d9`** — the `hydratedRef` gate, `EMIT_NOTHING`, the drain's baseline refusal, and their rails |
| **Fix commit #2** | **`8826e8aa7`** — the null-baseline hunt, the `??`-vs-truthy fix (`baseline.js`), the blocked-entry audit, the inherited-red ledger, the memory-pointer gate, the deploy packet |
| **Reconciliation** | **`9741ddff1`** (merge of `184a7e77b`) + **`b8eedb42f`** — the master merge, the artifact-verified flag, the five index retirements, the corrected packet |
| **Branch tip** | `b8eedb42f` **plus one docs-only commit stamping this table**. ⛔ A doc cannot name its own SHA; that is why this row says what each commit IS rather than pretending to a single "the commit". Read the tip with `git log --oneline -1`, always. |
| **`origin/master`** | ⛔ **MOVES — do not quote it, measure it.** It was `78ac8016b` when this session began and `184a7e77b` four hours later (three OptionsFlow commits, no overlap with this branch). What is invariant, and what to actually check: **no commit above is an ancestor of `origin/master`**, and `OFFLINE_DEFAULT_ON` is `false` there. |

⛔ **Do not collapse these two into "the commit".** An earlier version of this
doc said only *"Last Wave Q commit: `4fef130d9`"*, which was true when written and
stale one commit later — the docs commit `d445f8779` moved the tip the same day.
A doc naming the wrong tip sends the next session looking for work that is
already there. Verify both, never quote them:

```bash
git log --oneline -1                                      # the tip, right now
git log --oneline -S hydratedRef -- app/src/pages/journal-2-0/   # the fix commit
git merge-base --is-ancestor <sha> origin/master && echo ON MASTER || echo not on master
```

Branch `notebook-primary-platform`, worktree
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

⭐ **And a better one that needs no sign-in and no browser — read the flag out of
the DEPLOYED BUNDLE.** This is the artifact, not the source default:

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36"
# 1. the entry chunk names the lazy ones; the flag lives in the Notebook chunk
curl -s -H "User-Agent: $UA" https://uctintelligence.com/ | grep -oE '/assets/index-[^"]+\.js'
# 2. find the chunk carrying the opt-in key, then read the compiled default
curl -s -H "User-Agent: $UA" https://uctintelligence.com/assets/NotebookTab-<hash>.js \
  | grep -oE '.{130}uct\.j2\.offline\.enabled.{130}'
```

Measured 2026-09-09 on the live artifact:

```js
const Fi=!1, Mi="uct.j2.offline.enabled";
function ws(t=globalThis.localStorage){ try{ const n=t?.getItem(Mi);
  if(n==="1")return!0; if(n==="0")return!1 }catch{} return Fi }
```

`Fi = !1` **is** `OFFLINE_DEFAULT_ON = false`, and `offlineEnabled()` returns it
when the key is unset. ⛔ The chunk hash changes every deploy — crawl for the key,
never bookmark the URL.

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

# THE DEPLOY PACKET — for review, NOT deployed

⛔ Nothing here has been run. `origin/master` is untouched, the branch is pushed,
and `OFFLINE_DEFAULT_ON` is still `false`.

## (a) Member-impact paragraph

**Nothing about this changes what a member sees or does.** The offline Notebook
layer stays switched off, exactly as it is today; this is a bug fix to the note
editor's autosave, plus the tests that hold it in place.

**What was happening before it.** When you create a note and start typing, there
is a moment before your first save reaches the server where your words exist only
in your browser. If you reloaded the page in that window, the editor could
overwrite its own local backup of that note with an **empty** document — the very
copy that exists to protect words the server does not have yet. The note then
reads as blank, and the backup that would have restored it has been replaced. It
needed a specific and unlucky sequence (create a note, type, reload before the
save lands), which is why it went unnoticed for a long time; it was found
deliberately, by a scripted test against production.

**Blast radius if this fix is wrong.** One screen: the Notebook note editor's
autosave. The change makes the editor refuse to save until the note it is
showing has finished loading. If that refusal were too broad, the symptom would
be *"my typing is not being saved"* — loud, immediate, and reported within
minutes, not silent. It cannot affect any other tab, and it cannot affect notes
that are already saved.

**What is explicitly NOT changing.** Offline Notebook editing stays **off**
(`OFFLINE_DEFAULT_ON = false`). No member gets an offline working copy, an
outbox, or background syncing from this deploy. The service worker is untouched.
Nothing is migrated, and no member data is read, moved, or deleted.

## (b) Exact deploy sequence

```bash
cd C:\Users\Patrick\uct-worktrees\notebook-primary-platform

# 1. Prove what you are about to ship, and what is already red without it.
git fetch origin
git log --oneline origin/master..HEAD          # exactly the Wave Q1 commits, nothing else
git diff --stat origin/master -- app/src/pages/journal-2-0/lib/offline/offlineFlag.js
#    ^ MUST be empty: the flag is not part of this deploy

# ⛔ master MOVES under you. It gained three OptionsFlow commits mid-session and
#    THAT MERGE IS ALREADY DONE on this branch (clean, zero conflicts, zero lines
#    changed in any of the six fix files). Re-measure anyway — it may move again:
BASE=$(git merge-base origin/master HEAD)
git rev-list --count $BASE..origin/master      # behind: 0 if nothing new landed
comm -12 <(git diff --name-only $BASE..origin/master | sort -u) \
         <(git diff --name-only $BASE..HEAD          | sort -u)
#    ^ empty overlap + fewer than six behind ⇒ merge and push, no rebase
#    ⛔ If a conflict lands in ANY of the six fix files, STOP and show the diff:
#       NoteEditorPage.jsx · outboxDrain.js · baseline.js · useDurableNote.js
#       · recoverLocalState.js · useOutboxDrain.js

cd app && npx vitest run src/pages/journal-2-0   # gate: 231 files / 2391 tests green
cd .. && python -m pytest tests/test_note_updated_at_is_always_a_baseline.py -q

# 2. Ship. `master` IS production.
git push origin notebook-primary-platform:master

# 3. Verify by the ARTIFACT, never by the source default. 5-12 minutes.
curl -s -H "User-Agent: Mozilla/5.0 Chrome/152" https://uctintelligence.com/api/health
#    ^ uptime_seconds must RESET. Cloudflare 1010-blocks raw curl UAs.
git show origin/master:app/src/pages/journal-2-0/lib/offline/offlineFlag.js | grep OFFLINE_DEFAULT_ON
#    ^ must still read `false`
```

In a signed-in browser console, the dark proof — **no lock claimed**:

```js
const q = await navigator.locks.query()
;[...q.held, ...q.pending].filter(l => String(l.name).startsWith('uct.nb.sync.'))   // → []
```

## (c) Rollback

One revert, one push, one deploy cycle — the same shape as the 15-minute
rollback on 2026-09-09.

```bash
# The SHA to revert is not knowable before the deploy — DERIVE it, never type it.
git fetch origin
git log --oneline -5 origin/master           # the Wave Q1 commits are at the top
BAD=$(git rev-parse origin/master)           # if Wave Q1 is the newest thing on master
git revert --no-edit -m 1 $BAD               # -m 1 only if $BAD is a MERGE commit
git push origin HEAD:master
# 5-12 minutes, then verify the artifact's uptime reset again.
```

⛔ **`-m 1` is required if, and only if, the commit being reverted is a merge.**
Wave Q1 reaches master as a merge (the branch carries master's own OptionsFlow
commits back), so expect to need it. `git revert` without `-m` on a merge fails
loudly rather than silently doing the wrong thing — that is the safe direction.

⭐ **Rolling this back is cheaper than the last rollback was**, because there is
no flag to also flip and no local state to reason about: the offline layer is
already off, so nothing on any member's disk changes in either direction. The
only thing the revert restores is the old autosave behaviour.

⚠️ If the symptom is "typing is not saving", **do not wait for a diagnosis** —
revert first. The failure mode of the gate is a refusal, and a refusal is not
something to debug in front of members.

## (d) The §15 canary script

⛔⛔ **THE ORIGINAL §15 SCRIPT DOES NOT EXIST ANYWHERE REACHABLE. SEARCHED
2026-09-09, AND THE SEARCH IS RECORDED SO NOBODY REPEATS IT:**

- `git log -S "§15" --all -- docs/` → only the Wave Q docs that *cite* it
- `git log -S "canary" --all -- docs/` → same set, plus Wave P (a different wave)
- every `§15` in-repo is a **different numbering scheme**:
  `competitive-primary-platform-phase-zero.md` §15 is *"Save-to-Notebook Across
  UCT"*, and `wave-q0-architecture.md:614` cites *"the §15 non-negotiables"* —
  neither is a canary script
- memory: four files mention `§15`, all citations, none a script
- `tools/wave_p_activation_canary.py` is **Wave P** (OCR, one synthetic
  document) — not this
- ⭐ The whole `§N` numbering in the Wave Q docs cites **the owner's activation
  directive**, which is not in the repo, not in memory and not in git history.
  The only surviving fragment of §15 is one sentence in
  `wave-q1-activation-canary-red.md`: *"Step 9 of the §15 happy path is reload /
  tab reopen"* and *"§15's ordering — open → edit → reload → recover"*.

**So what follows is RECONSTRUCTED** from that fragment plus the certified
Chrome 152 path. ⛔ **Check it against your own directive before running it** —
the value of a canary is that it is run identically to last time, and this
version cannot prove that it is.

Preconditions: production, signed in, Chrome. The offline layer is off by
default, so opt this browser in exactly as certification did:

```js
localStorage.setItem('uct.j2.offline.enabled', '1')   // opt IN
// …and to opt back out at any moment:
localStorage.setItem('uct.j2.offline.enabled', '0')
```

### Happy path

1. Open the Notebook. Confirm the dark default first: with the key **unset**, a
   `navigator.locks.query()` shows no `uct.nb.sync.*` lock.
2. Opt this browser in (above). Reload.
3. Confirm the lock is now claimed — exactly one `uct.nb.sync.*` held.
4. **Create a new note.** ⛔ This is the shape that failed last time; do not
   substitute an existing note.
5. Type a title, a subtitle, and a paragraph of body.
6. Confirm all three local layers hold the work: the `uct.j2.notedraft.<id>`
   localStorage key, the `notes` record, and the `outbox` entry in the
   per-account IndexedDB.
7. Kill the network (DevTools offline). Type more.
8. Confirm the header says **"Reconnecting…"** *and* **"Saved on this
   device/in this browser · waiting to sync"**. ⛔ Assert the rendered text, not
   a devtools state.
9. **Reload the page.** ⭐⭐ **THIS IS THE STEP THAT WENT RED.** Then read all
   three layers again.

   | | before the fix | expected now |
   |---|---|---|
   | `notes` record | `title:"" subtitle:"" body:{doc,[paragraph]}` | the member's words, unchanged |
   | `outbox` entry | the same empty patch, `baseUpdatedAt: null` | the member's words, with a real baseline |
   | localStorage draft | the empty document | the member's words |

   ⛔ **If any layer is empty, STOP and roll back.** That is the original defect.
   ⛔ **If any outbox entry has `baseUpdatedAt: null`, STOP** — the drain now
   refuses to send it, so nothing is destroyed, but it means a producer exists
   that this session could not find, and the owner should hear about it before
   the flag is flipped.
10. Restore the network. Confirm the queue drains and the record goes clean
    (`dirty: 0`), re-based on the revision the save created.
11. Clean up canonically: soft-delete the canary note through the normal
    lifecycle; confirm the per-account store is empty on all four stores.

### Conflict path

1. Same opt-in. Open an existing note with real prose in it.
2. Type an edit. Go offline before the save lands, so the work is queued.
3. In a **second** signed-in context (another browser/profile), edit the *same*
   note and let that save land. The server revision has now moved.
4. Bring the first context back online.
5. Expected: the stale compare-and-set is **rejected**, the server's copy is
   **byte-unchanged**, and the local work survives as a real
   **"(conflicted copy)"** note tagged `sync-conflict`. The header reads
   *"Conflict — this note changed elsewhere. Your version was kept as a
   conflicted copy."*
6. ⛔ Confirm the server's copy did not move. That is the whole invariant.

### What the fix changes about what you should expect

- Step 9 is the only step whose expected result changed — from "all three layers
  empty" to "the member's words intact".
- A note whose **server copy is empty** (a brand-new note) no longer triggers an
  autosave on open. If you watch the network, you should see **no PUT at all**
  from merely opening such a note. Before the fix there was one.
- Nothing else in either script should behave differently. A difference anywhere
  else is a finding, not noise.

## (e) GO / NO-GO

| | status |
|---|---|
| The canary defect is reproduced, fixed, mutation-proved | ✅ `4fef130d9` |
| `journal-2-0` suite green | ✅ **231 files / 2391 tests** |
| The `??`-vs-truthy baseline defect fixed + railed | ✅ one authority, mutation-proved |
| Backend baseline guarantee railed + mutation-proved | ✅ 14 tests, 2 mutations |
| Full frontend suite green | ❌ **8 files red — all inherited, see `inherited-red-ledger.md`** |
| `OFFLINE_DEFAULT_ON` untouched | ✅ `false` on the reconciled branch, on `184a7e77b`, and on the deployed artifact |
| Reconciled with the current master | ✅ merged clean, 0 conflicts, 0 lines changed in the six fix files |
| Mutations re-run post-merge | ✅ 4/4 red, controls green, restored |
| Service worker untouched | ✅ |
| `baseUpdatedAt: null` **explained** | ❌ **NOT closed** — see below |
| The drain cannot run at all with the flag off | ✅ **traced from the flag to the call, and railed** — see the flag-flip gate |

**My recommendation: DEPLOY THE FIX. Do not flip the flag yet.**

**Would I ship with the null baseline still unexplained? Yes — for this
deploy, and no for the flag.** The reasoning, so you can disagree with it:

- The null is only *dangerous* if such an entry can be **sent**. It cannot: the
  drain refuses any baseline-less entry, and that refusal is mutation-proved
  from three different test files.
- The only producer that survives measurement is *"the server hands the editor a
  note with no `updatedAt`"*, and the server provably cannot: every writer is
  railed, including untrusted import payloads.
- Deploying the fix strictly **reduces** exposure — with the flag off, today's
  production still overwrites a member's local backup with an empty document in
  the create-type-reload window. That is a live defect right now.
- The flag is different. Flipping it attaches a queued server mutation to local
  state, and that is the machinery an unexplained null could ride. It should
  wait for a clean §15 canary **on the deployed fix**.

⛔ **The "a blocked entry is invisible" finding is NOT on this list**, because
it cannot happen while the flag is off — see the separate flag-flip gate below,
where it is the first item.

---

# THE FLAG-FLIP GATE — a SEPARATE list, and not the deploy's

⛔ **These are not deploy blockers.** With `OFFLINE_DEFAULT_ON = false` the drain
cannot execute at all, so every item here is dormant until the flag flips.

## Why they are separable — traced from the flag to the drain call

```
NotebookTab.jsx:74        useOutboxDrain({ accountId, excludeNoteId })   ← the ONLY mount site
  └ useOutboxDrain.js:89  supported = offlineEnabled() && offlineStorageAvailable()
                                       && accountId && enabled
      └ offlineFlag.js:63 offlineEnabled(): key '1'→true · key '0'→false
                          · UNSET → return OFFLINE_DEFAULT_ON   ← production: false
  ⇒ supported === false, and then THREE independent refusals:
      · the leadership effect      `if (!supported) { setRole(null); return }`  → no lock claimed
      · drainNow                   `if (!supported || roleRef.current !== LEADER) return null`
      · the trigger effect         `if (!supported) return undefined`  → no listener, no interval
```

⭐ **`drainOutbox()` has exactly ONE caller in the whole app** — inside
`drainNow`, behind that gate. There is no second path to it.

⛔ **The rail that existed did NOT cover production's actual state.** §21 sets
the key to `'0'`; production leaves it **unset**, which is a *different branch*
of `offlineEnabled()` (`return OFFLINE_DEFAULT_ON`). §21b now covers the unset
case — no lock claimed, nothing sent, `drainNow()` called directly still refuses
— with a control that drains on opt-in, and mutation-proved: flip the shipped
default to `true` and **exactly the two new rails go red while §21 stays green**,
which is what proves they test different lines.

## The list

| | status |
|---|---|
| A blocked entry is surfaced to the member | ❌ **it is not** — see below |
| `baseUpdatedAt: null` explained | ❌ not closed (harmless — the drain refuses it) |
| A fresh §15 canary on the deployed fix | ⛔ not run |
| Seven-day observation window armed | ⛔ not started (`wave-q1-observation-window.md`) |

### The blocked-entry finding, in full (measured, `blockedEntryIsVisible.test.jsx`)

| question | answer |
|---|---|
| Are the member's words intact? | ✅ every word, on disk; the record stays `dirty: 1`; the outbox keeps the full patch |
| Is the block recorded? | ✅ `permanent: true` + a readable `lastError` naming the missing baseline |
| What does the save indicator show? | ✅ **on the open note, honestly** — "Reconnecting…" plus "Saved on this device/in this browser · waiting to sync". Asserted as rendered TEXT, not state. |
| Do later writes for that note still drain? | ✅ **a later edit UN-BLOCKS it.** The outbox is keyed `note:<id>`, so a fresh durable write replaces the entry and the replacement carries no `permanent` flag. A hold, not a dead end. |
| Does it wedge other notes? | ✅ no — another note still sends (`blocked: 1, sent: 1`) |
| Does it retry itself? | ❌ no, by design — that is the point of the refusal |
| **Is it surfaced anywhere else?** | ⛔⛔ **NO.** `summarize()` has ZERO consumers in the app and `BLOCKED` appears in no component. For a note the member is not looking at, the hold is **completely silent.** |

⛔ **That last row is the one to close before the flag.** The words are safe and
the hold is recoverable — but only by a member who happens to edit that note
again, for a reason nothing on screen ever gives them.

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
  Every one is blamed to a SHA in **`docs/notebook/inherited-red-ledger.md`** —
  read that instead of re-deriving it, and add a row rather than re-investigating.
  **Repo-green must never be claimed**; report `journal-2-0` (230 files / 2388
  tests green) and the full suite as two separate numbers.
  ⛔ Answer "did my change cause this?" with `git show <sha>:<file>`, never
  `git status` — one offender sits inside `journal-2-0` and is still not ours.
- ⛔ **A rail can be green alone and red in company.** Both new rail files were
  re-checked inside the full 1,171-file run, not just on their own.
- ⛔ Deploys take 5–12 minutes and `master` **is** production. Verify by the
  artifact (`/api/health` uptime reset), never by the source default.

---

## Cleanup owed

- ⚠️ **`.worktrees/master-baseline` — ~3,900 files, needs a manual delete.**
  A scratch worktree checked out at `184a7e77b` to run the eight inherited-red
  files directly against the new master. The run was **abandoned as invalid** (a
  fresh worktree has no `node_modules`, and the junction recipe still left Vite
  resolving its temp config from the parent repo → `ERR_MODULE_NOT_FOUND`, a
  **startup error, not a test result**). Git's registry is pruned and
  `git status` is clean, but something holds a file handle so `rmdir /s /q`
  fails. It is **gitignored** (`.gitignore:3`) and cannot reach a commit or a
  deploy. Delete it once whatever holds it exits:

  ```
  cmd /c "rmdir /s /q C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees"
  ```

  ⛔ Do NOT `git worktree remove` it — that is already done; only the directory
  remains.

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
