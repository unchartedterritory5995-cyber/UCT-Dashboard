# Wave Q1 — RESUME HERE

# ✅✅ DEPLOYED TO PRODUCTION — 2026-09-10 02:40:01 UTC

**`cd674ef56` is on `master` and live.** `OFFLINE_DEFAULT_ON` is still `false`:
the offline layer did NOT ship on, and this deploy did not touch the flag.

| | |
|---|---|
| master before | `4879d4d02` |
| master after | `cd674ef563edb1c7f2d815a85cd8bf98b5763d9c` |
| push | 2026-09-10 **02:39:59 → 02:40:01 UTC** |
| build live | **02:42:29 UTC** — bundle `index-4oJCblT8` → `index-4qGFp_8B`, uptime reset to 38 s |
| carried | 20 commits, Wave Q1 only |

**Verified on the live artifact, not on the source default:**

```
EMIT_NOTHING   {emitUpdate:!1} present · ZERO bare setContent(x,!1) remain
the gate       jt=()=>{if(!vt.current)return;x("dirty"),...}   ← refuses BEFORE
                                                                 touching status
the flag       zi=!1  →  OFFLINE_DEFAULT_ON === false          ← still dark
```

✅✅ **THE §15 CANARY IS COMPLETE AND GREEN** — online half, offline half
(including the step that went red on 2026-09-09), and the conflict path through
the drain's fork. No `null` or `''` baseline in any artifact. The seven-day
observation window is **STARTED: 2026-09-10 → 2026-09-17.**

## ⏭️ AND THE FLAG-FLIP GATE IS BEING WORKED — 2026-09-10, on the branch

⛔⛔ **NONE OF THIS IS DEPLOYED.** It is on `notebook-primary-platform` only, and
`OFFLINE_DEFAULT_ON` is untouched. Read the **FLAG-FLIP GATE** section, not this
summary, before acting on any of it.

- ✅ **A blocked entry is surfaced to the member** — the gate's last open row.
  Both notes-list views and the open note's header now say **"Edit again to
  sync"** in the shipped vocabulary. Item 1 below.
- ⏳ **The `null` is INSTRUMENTED, not explained** — nine driven paths failed to
  reproduce it, so the gate condition CHANGED: from *"explained"* to *"zero
  occurrences during the window"*. Item 2 below. ⛔ The count is not measurable
  until this deploys.
- ⛔ **An offline reload cannot load the Notebook at all** (no service worker, by
  design). Written down as a KNOWN LIMITATION and as an expected §15
  observation — **never a red**. Item 3 below.
- 📋 **The window-watch log** starts at check 1, 2026-09-10T04:16:51Z.

---

**Written 2026-09-09 before a machine restart.** Updated repeatedly through
2026-09-09/10: the defect reproduced and fixed (`4fef130d9`), the
`baseUpdatedAt: null` question run to ground, the deploy packet written, and
finally deployed.

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
| That fix | ✅ **DEPLOYED** `cd674ef56`, 2026-09-10 — verified on the live bundle |
| §15 canary | ✅ **COMPLETE AND GREEN**, both halves + the conflict fork |
| Blocked entries surfaced to the member | ✅ **built 2026-09-10 — on the branch, NOT deployed** |
| The `null` baseline | ⏳ **instrumented, not explained** — on the branch, NOT deployed, so the window's count is not measurable yet |
| Harness integrity | **green** — identity, ports, controls, mutation-proved |
| Q2 | **locked** |
| Service worker | untouched, and stays untouched |

### The SHAs — two different facts, both stated on purpose

| | |
|---|---|
| **Fix commit #1** | **`4fef130d9`** — the `hydratedRef` gate, `EMIT_NOTHING`, the drain's baseline refusal, and their rails |
| **Fix commit #2** | **`8826e8aa7`** — the null-baseline hunt, the `??`-vs-truthy fix (`baseline.js`), the blocked-entry audit, the inherited-red ledger, the memory-pointer gate, the deploy packet |
| **Reconciliation** | **`9741ddff1`** (merge of `184a7e77b`) + **`b8eedb42f`** — the master merge, the artifact-verified flag, the five index retirements, the corrected packet |
| **Gate split** | **`32706ecae`** — the drain traced from the flag (§21b rails), the blocked-entry gap moved to the flag-flip gate, the §15 search recorded |
| **Pre-flight** | **`11f3e812f`** — merged master `3b043d0f8`, ledger row 9 (the `ImportWizard` load-sensitive timeout), packet SHAs refreshed. ⛔ Ran under **HOLD**: the directive's DECISION line arrived unfilled. |
| **Deploy attempt 1** | **`c2d8f5f58`** — DEPLOY authorised; pre-flight all green; **STOPPED at the pre-deploy re-fetch**, master had moved again (`590e88084`→`b41b4ed07`). Push is mechanically rejected as non-fast-forward. See §(b0). ⛔ **Nothing was pushed to master.** |
| **Deploy attempt 2** | scope-gated loop authorised; **gate FIRED on iteration 1** — six commits incl. chart-watermark work touching six files under `app/`. Did not merge, did not deploy. See §(b-1). ⛔ **Nothing was pushed to master.** |
| **DEPLOYED** | **`cd674ef56`** on `master`, 2026-09-10 **02:40:01 UTC**, live **02:42:29**. Gate classified the chart work TIER 2 → merged, full re-verify, ledger unchanged → 0 behind → deployed. Verified on the live bundle. |
| **Canary** | **`9b28cedf0`** — PARTIAL: steps 1–6/10/11 green incl. the fix's own signature; **steps 7–9 (offline) and the conflict path NOT run**; observation window NOT started |
| **Canary, offline half — attempt 1** | **`c604aa899`** — BLOCKED 2026-09-10: no CDP executor, Chrome has no `--remote-debugging-port`. Amendment recorded; stopped rather than improvise. Keyboard recipe written. ⭐ Superseded by the two rows below — kept because *what was tried and why it stopped* is the part a next session would otherwise repeat. |
| **The CDP rig** | **`59612df1c`** + **`22c4e1be3`** — a SECOND Chrome with its own throwaway profile, `--remote-debugging-port=9411` on 127.0.0.1, driven by Playwright `connect_over_cdp`; offline proven both ways before use. The second commit is the correction that the owner's Chrome is checked by the BROWSER process and the profile marker, **never by a process COUNT** (a count false-alarmed at 14/15 on a reaped child). |
| **✅ CANARY COMPLETE** | **`07815b107`** (rig at `22c4e1be3`) — offline half incl. **the step that was 9/9 red**, and the conflict path through the drain's fork. All green. **No `null`/`''` baseline in any artifact ⇒ no NEW FINDING.** Observation window started. |
| **Branch tip** | `07815b107` **plus this docs-only commit stamping the table**. `master` is at `cd674ef56` (the deploy). ⛔ A doc cannot name its own SHA; that is why this row says what each commit IS rather than pretending to a single "the commit". Read the tip with `git log --oneline -1`, always. |
| **`origin/master`** | ⛔ **MOVES — do not quote it, measure it.** Observed `78ac8016b` → `184a7e77b` → `3b043d0f8` → `590e88084` → `b41b4ed07` → `4879d4d02` inside one session — eleven commits, three authors. The first eight touched **zero** files under `app/`; the last six included chart-watermark work that did. All merged in; the branch is **level with master** as of the last pre-flight. What is invariant, and what to actually check: **no commit above is an ancestor of `origin/master`**, and `OFFLINE_DEFAULT_ON` is `false` there. |

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

## ⭐ (b-1) THE DEPLOY PROCEDURE — a THREE-TIER scope-gated reconcile loop

**Owner-authorised 2026-09-09**, replacing "stop if master moved at all", then
refined to three tiers after the first version's `app/**` hard stop fired on
chart-watermark work that could not touch the Notebook.

**Why a gate and not a freeze.** Other sessions pushed to `master` **eight times
in one day** (16:31 · 16:57 · 17:11 · 18:25 · 18:25 · 18:44 · 18:55 · 19:41)
while a full Wave Q1 pre-flight takes **30–40 minutes**. **A pre-flight can never
win a race against a freeze.** Worse, `git push branch:master` is *mechanically*
rejected as non-fast-forward once master moves — so "deploy without reconciling"
is not an option that exists, and a freeze that forbids reconcile-and-deploy is a
deadlock, not a safeguard.

**Run it:** `python tools/deploy_scope_gate.py <old> <new>` — exit **1** = tier 1,
**2** = tier 2, **0** = tier 3. `--self-check` proves each tier can fire.

### TIER 1 — HARD STOP, wait for the owner

`lib/offline/**` · `api/**/notes.py` · anything under `journal-2-0` · the
outbox/drain · the durable store · the TipTap wiring · the flag definition · the
service worker · any of the seven guarded files.

*Why:* if master changed this, the branch's fix is no longer being deployed onto
the code it was verified against.

### TIER 2 — MERGE, then FULL RE-VERIFY, then continue the loop

Any other path under `app/**`.

*Why:* it cannot touch the Notebook sync path, but **the frontend suite reads
it**, so the inherited-red ledger's "identical by construction" argument stops
holding and must be re-established:

```
a) journal-2-0 at rest, alone      c) full frontend suite
b) backend baseline rail           d) ledger re-verified against the NEW master
```

⛔ **In that order.** Never full-suite-then-journal-2-0 — that ordering
manufactures a population of timeouts that say nothing about the code.

### TIER 3 — FAST LOOP, then continue

Everything else (backend, docs, tooling). Merge · flag check · backend rail if
`api/**` moved · journal-2-0 at rest · refresh the packet SHAs.

### The loop itself

Max **5** iterations. Each: `git fetch` → if **0 behind**, exit to 4.2 → else
list every new commit **with its full file list from `git diff --name-only`**
(⛔ mechanically, never from subjects) → classify → act by tier → confirm **zero
lines changed in the seven guarded files** → push the branch → repeat. On
exhausting 5 iterations without reaching 0 behind, **STOP** — master is
outrunning even the fast loop.

### Runs so far

| attempt | outcome |
|---|---|
| 1 (freeze) | STOPPED at the pre-deploy re-fetch; master moved; push mechanically rejected |
| 2 (one-tier gate) | **TIER 1 fired** on six commits touching six `app/` files (chart watermark, bars deep-history) — correct under that rule, but the rule was too broad |
| 3 (three tiers) | those same commits classify **TIER 2**: merged, full re-verify run, **ledger unchanged — same 8 reds, offender lists byte-identical (26 = 26), all 12 blaming commits still ancestors of the new master** |

## ⛔⛔ (b0) THE FREEZE THIS REPLACED — kept as the record of why

**2026-09-09, attempt 1: STOPPED at the pre-deploy re-fetch. Master moved
between reconcile and deploy, for the eighth time that day.**

A second session (`Claude Fable 5`, pattern-vision / flow work) was pushing to
`master` roughly every 15–45 minutes:

```
16:31 · 16:57 · 17:11 · 18:25 · 18:25 · 18:44 · 18:55 · 19:41
```

A full Wave Q1 pre-flight takes **~30–40 minutes** (full suite ~6 min, five
mutations ~15 min, journal-2-0 at rest ~2 min each). So the branch is overtaken
before the deploy step is reached, every time.

⛔ **AND IT IS NOT ONLY A POLICY STOP — THE PUSH IS MECHANICALLY REJECTED.**
Measured with `git push --dry-run origin notebook-primary-platform:master`:

```
 ! [rejected]   notebook-primary-platform -> master (non-fast-forward)
```

So "deploy without reconciling" is not an option that exists, and "reconcile then
deploy in one motion" is what the directive forbids. That is a genuine deadlock,
not a judgement call, and it needs an owner decision to break:

1. **Relax the stop to a SCOPE test** — stop only if master's new commits touch
   `app/` or an in-scope area. ⭐ **Every one of the eight master commits that
   day touched ZERO files under `app/`**, so this is the option that reflects the
   actual risk rather than the mere fact of movement.
2. **Coordinate** — ask the other session to hold pushes for ~10 minutes.
3. **Accept a reconcile-and-deploy in one motion**, with the reconcile's scope
   check as the safety property instead of the freeze.

⚠️ Whichever is chosen, record it here. The next session will hit this again.

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

## (d) The §15 canary script — SCRIPT OF RECORD, accepted 2026-09-09

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

## ⭐ SCRIPT OF RECORD — accepted 2026-09-09

**The owner read this script and accepted it as the script of record**, in the
deploy directive of 2026-09-09, in place of the original that no longer exists.
It was reconstructed from the surviving fragment above plus the certified
Chrome 152 path; that provenance is kept because it is true, but the script is
no longer provisional. **This is what runs.**

⛔ It follows that a future session may not quietly "improve" it. A canary is
only comparable to the last one if it is the same script — change it only with
the owner's word, and record the change here.

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
9. **Reload the page** — ⛔ **WITH THE NETWORK BACK UP.** ⭐⭐ **THIS IS THE STEP
   THAT WENT RED.** Then read all three layers again.

   ⛔⛔ **AN OFFLINE RELOAD IS AN EXPECTED OBSERVATION, NOT A RED.** Wave Q1 has
   **no service worker**, by design, so reloading while the network is down
   cannot fetch `index.html`: the SPA never loads, the browser shows its own
   error page, and storage is not even readable from that context
   (`draft:"ERR"`, `dbMissing:true` — measured 2026-09-10). Nothing is lost, and
   nothing is proved either — the rebuild path this step exists to exercise
   never runs. **If you reload while offline, you have not performed step 9.**
   Restore the network first; the incident's own ordering is *open → edit
   offline → reload → recover*, and the reload was online.

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
  empty" to "the member's words intact". Its **preconditions** also changed: the
  reload is performed with the network **up** (see the ⛔⛔ block on that step).
- A note whose **server copy is empty** (a brand-new note) no longer triggers an
  autosave on open. If you watch the network, you should see **no PUT at all**
  from merely opening such a note. Before the fix there was one.
- Nothing else in either script should behave differently. A difference anywhere
  else is a finding, not noise.

## (e) GO / NO-GO

| | status |
|---|---|
| The canary defect is reproduced, fixed, mutation-proved | ✅ `4fef130d9` |
| `journal-2-0` suite green | ⚠️ **230 files / 2391 — green AT REST**, eleven consecutive runs. Under sustained load a POPULATION of timeouts appears (three different tests observed, all byte-identical to master) — ledger row 9. ⛔ Run the gate AT REST; a full-suite-then-journal-2-0 ordering manufactures failures that say nothing about the code. **Not ours, not banked.** |
| The `??`-vs-truthy baseline defect fixed + railed | ✅ one authority, mutation-proved |
| Backend baseline guarantee railed + mutation-proved | ✅ 14 tests, 2 mutations |
| Full frontend suite green | ❌ **8 files red — all inherited, see `inherited-red-ledger.md`** |
| `OFFLINE_DEFAULT_ON` untouched | ✅ `false` on the reconciled branch, on `origin/master` (`4879d4d02`), and on the deployed artifact (read from the live bundle: `Fi=!1`) |
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

# THE §15 CANARY — RUN 2026-09-10, AGAINST THE DEPLOYED FIX

✅✅ **COMPLETE AND GREEN.** Happy path 2026-09-10 (online half) · offline half
and conflict path 2026-09-10 (CDP rig). Recorded step by step so it is comparable
to `wave-q1-activation-canary-red.md`.

## ⭐⭐ PART A — THE OFFLINE HALF, AND THE 9/9 RED STEP IS GREEN

| step | expected | observed | |
|---|---|---|---|
| 7 · offline via CDP | a probe must actually fail | `fetch('/api/health')` → **FAILED: TypeError in 1 ms**, `navigator.onLine=false` | ✅ |
| 8 · type offline | words in all three layers, `dirty:1`, REAL baseline | draft + durable + outbox all carry the typed title and body; `dirty:1`; **`baseUpdatedAt:"2026-09-10T03:30:28.959081+00:00"`**. Header, as rendered text: **"Saved on this device · waiting to sync · Reconnecting…"** | ✅ |
| 9 · **reload with unsynced work** | no empty document, real baseline | **all three layers still hold the member's offline words**; `dirty:1`; baseline still the real timestamp; editor mounted (control); the screen shows the SERVER copy and the banner **"Unsaved changes from a previous session were found for this note. / Restore"** — offered, never auto-applied | ✅ |
| 10 · reconnect | one PUT with the CAS baseline; `dirty:0`; server has the words | outbox **emptied**, record `dirty:0` re-based on `03:34:19.455110`, **server now carries the offline title AND body**, baseline == server `updatedAt` | ✅ |

⭐ **NO NEW FINDING.** No artifact in any step carried a `null` or `''` baseline.

```
9/9  INCIDENT  all three layers: {title:"", subtitle:"", body:{doc,[paragraph]}}
                                  baseUpdatedAt: null
9/10 CANARY    all three layers: the member's OFFLINE words
                                  baseUpdatedAt: "2026-09-10T03:30:28.959081+00:00"
```

### ⚠️ Two things the reconstructed script got wrong, corrected here

⛔ **"Reload the page" cannot be done WHILE OFFLINE.** Wave Q1 deliberately has
**no service worker**, so an offline reload cannot fetch `index.html`: the SPA
never loads, Chrome shows its own error page, and `localStorage`/IndexedDB are
not even readable from that context (`draft:"ERR"`, `dbMissing:true`). Measured.
**That step proves nothing about the product** — the dangerous rebuild path never
runs. The meaningful ordering is the incident's own: *open → edit offline →
reload → recover*, with the network available for the reload itself. That is what
ran, and that is what is green.

⛔ **Step 10 does not drain while the note is OPEN.** `excludeNoteId` hands the
open note to the editor, never the sweep — two writers on one note is exactly
what this wave forbids. The queued entry correctly waits until the member accepts
the banner, edits, or **navigates away**. The first step-10 reading looked like a
stalled drain and was not: navigating away drained it immediately.

## ⭐⭐ PART B — THE CONFLICT PATH, THROUGH THE DRAIN'S FORK

Not an online-409 substitute: the editor was **offline** (CDP), typed, and the
work was **queued**; a second client then moved the server; the drain sent the
stale-baseline entry on reconnect.

| | |
|---|---|
| B0 server | `updatedAt 03:34:19.455110` — the baseline the editor holds |
| B1 offline | probe **FAILED: TypeError** |
| B2 queued offline | `dirty:1`, patch = the member's words, baseline `03:34:19` (now stale) |
| B3 second writer | a different tab, online, direct API PUT → server moves to `03:35:41.000485` |
| B4 reconnect + hand back | **server STILL the second writer's words, byte-unchanged** · a real note **`"… (conflicted copy)"` tagged `sync-conflict`** created, and its body **contains `MEMBER-OFFLINE-SENTINEL`** and *not* the second writer's · local record adopted the SERVER copy (`dirty:0`, `generation:0`, `sessionId:null` — `settleForked`) · **outbox empty** |

✅ **No clobber in either direction. No baseline-less send. No lost words.**

| step | expected | observed | |
|---|---|---|---|
| 1 · dark default, key unset | no `uct.nb.sync.*` lock | key `null`, **0 locks** | ✅ |
| 2 · opt this browser in | key `1` | key `1` | ✅ |
| 3 · lock claimed | exactly one, held | **1 held EXCLUSIVE**, 0 pending, per-account DB `uct_notebook_<id>` opened | ✅ |
| 4 · create a new note | a note whose server body is empty | created; server returned **`bodyJson:{type:'doc',content:[]}`** and a real `updatedAt` | ✅ |
| ⭐ THE FIX'S OWN SIGNATURE | **no PUT** from merely opening such a note | **exactly ONE** request to `/api/j2/notes/<id>` — the GET. **No PUT.** All three local layers **empty**. Control: editor mounted, title rendered, ProseMirror present | ✅✅ |
| 5–6 · type, three layers hold it | draft + durable + outbox carry the words | all three carried them, and the durable record showed **`baseUpdatedAt: "2026-09-10T02:46:06…"` — a REAL baseline** | ✅ |
| 7–9 · **offline, type, reload** | the words survive | ⛔ **NOT RUN** — see below | — |
| 10 · reconnect, queue drains | `dirty:0`, re-based | `dirty:0`, outbox empty, draft cleared, **baseline exactly equals the server's new `updatedAt`** | ✅ |
| 11 · clean up canonically | note gone, store empty | soft-deleted, list back to **32 notes**, all four stores **0**, no leftover drafts, opted back out, **0 locks** | ✅ |
| conflict path | server byte-unchanged, local kept as a conflicted copy | ⛔ **NOT RUN** — needs a second signed-in context | — |

## ⭐⭐ The comparison that matters

```
INCIDENT 2026-09-09  {title:"", subtitle:"", body:{doc,[paragraph]}, dirty:1,
                      generation:1, sessionId:<new>, baseUpdatedAt:null}
CANARY   2026-09-10  {title:"…typed by the canary", subtitle:"",
                      body:{doc,[paragraph]}, dirty:1,
                      generation:1, sessionId:<new>,
                      baseUpdatedAt:"2026-09-10T02:46:06.097528+00:00"}
```

Same shape, same `generation: 1`, same fresh session — but the title is **the
member's words** instead of empty, and the baseline is **real** instead of null.

⭐ **NO NEW FINDING.** No artifact in this run carried a `null` or `''` baseline.

## ⭐ SCRIPT-OF-RECORD AMENDMENT — owner, 2026-09-10

**Step 7's "Kill the network (DevTools offline)" may be driven via CDP
`Network.emulateNetworkConditions {offline:true}` against the real browser
session.**

*Rationale (the owner's):* that is the mechanism the DevTools checkbox itself
uses, so it is **the same experiment, not a substitute for it**.

⛔ **Explicitly NOT permitted:** a `fetch` stub · a service-worker intercept · a
mocked transport. Each of those replaces the transport under test with a
different one and would be a different experiment wearing the canary's name.

⛔ **And no third method.** If CDP cannot be driven against the real session,
STOP and hand it back — do not invent an alternative.

### ⛔⛔ 2026-09-10: THE AMENDMENT COULD NOT BE EXECUTED. STOPPED, AS INSTRUCTED.

Measured, not assumed:

```
MCP browser toolset ...... DOM · input · screenshot · network-READ · console.
                           NO CDP command executor. Nothing can send
                           Network.emulateNetworkConditions.
chrome.exe processes ..... 15 running
  with --remote-debugging  0
listeners on 9220-9340 ... none
curl 127.0.0.1:922x/json/version ... no response on any probed port
```

CDP requires either a tool that speaks the protocol or a Chrome started with
`--remote-debugging-port`. **Neither exists here.** Relaunching the owner's
Chrome with the flag was rejected as out of scope: it would close their live
session, and a relaunched browser is not "the real browser session" the
amendment names.

**So steps 7–9 and the conflict path remain UNRUN**, and the seven-day
observation window stays **unstarted**.

### ⭐ THE CDP RIG — the amendment's mechanism, and it WORKS

**Owner clarification, 2026-09-10:** *"the real browser session" means a real
Chrome instance driving production over CDP — it does not require my current
window. A second Chrome instance with its own profile qualifies.* Fetch stubs,
service-worker intercepts and mocked transports remain forbidden.

⛔ **Never touch the owner's running Chrome.** Spawn a dedicated instance, own
exactly that PID, and kill only that PID at teardown.

**The exact launch command — use it verbatim on every re-run:**

```powershell
Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -PassThru -ArgumentList `
  '--user-data-dir=C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome-profile', `
  '--remote-debugging-port=9411', `
  '--remote-debugging-address=127.0.0.1', `
  '--no-first-run','--no-default-browser-check','--new-window','about:blank'
```

Then `curl 127.0.0.1:9411/json/version`, and connect with
`playwright.chromium.connect_over_cdp("http://127.0.0.1:9411")`.

**Offline is driven by CDP, and it is PROVEN to cut the transport** — measured
2026-09-10 *before any sign-in*, so the rig is validated independently of the
canary it carries:

```
Network.emulateNetworkConditions {offline:true}
   fetch('/api/health')  ->  FAILED: TypeError in 2 ms · navigator.onLine = false
Network.emulateNetworkConditions {offline:false}
   fetch('/api/health')  ->  ONLINE                    · navigator.onLine = true
```

⛔ **Always prove the probe fails before typing.** An "offline" step that is
silently still online turns the canary's decisive assertion into a tautology.

⚠️ **A fresh profile is NOT signed in** (`/api/auth/me` → 401). The owner signs
in in that window; the agent never enters credentials. Budget for that pause.

**Teardown, always, green or red:** kill the spawned browser process and any
straggler carrying `canary-chrome-profile` in its command line · delete
`.worktrees/canary-chrome-profile` · confirm the owner's BROWSER process is
unchanged · confirm the production end state (32 notes · all four stores 0 ·
0 locks · key `'0'`).

⛔⛔ **DO NOT CHECK THE OWNER'S CHROME BY PROCESS COUNT — IT WILL FALSE-ALARM.**
Measured 2026-09-10: the baseline was 15 `chrome.exe` PIDs; twenty minutes later
14 of those 15 were alive, and the missing one (`25772`) was a **renderer/utility
child Chrome had reaped on its own**. Nothing killed it. Chrome churns children
constantly.

The check that actually means something is the **browser** process — the one
whose command line has **no `--type=`**:

```powershell
$now  = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
$main = $now | Where-Object { $_.CommandLine -notlike '*--type=*' }
$main | ForEach-Object { "pid=$($_.ProcessId) mine=$($_.CommandLine -like '*canary-chrome-profile*')" }
```

Exactly two browser processes should appear while the rig is up: the owner's
(`mine=False`) and the canary's (`mine=True`). ⭐ **`canary-chrome-profile` is the
unambiguous marker** — it cannot match the owner's Chrome, so teardown can target
it without ever guessing at a PID.


### The 5-minute keyboard recipe, for whoever runs it

Same account, same note discipline as the 2026-09-10 happy-path run.

1. Open the Notebook, DevTools → Console:
   `localStorage.setItem('uct.j2.offline.enabled','1')` then reload.
2. Confirm the lock: `(await navigator.locks.query()).held.filter(l=>l.name.startsWith('uct.nb.sync.'))` → exactly one, `exclusive`.
3. Create a note, type a title/subtitle/body, let it save (watch it go `dirty:0`).
4. **DevTools → Network → Throttling → Offline.** Confirm a probe actually
   fails: `await fetch('/api/health').then(()=>'ONLINE').catch(()=>'OFFLINE')`.
5. Type more. Read all three layers (snippet below) — expect the typed words,
   `dirty:1`, and a **real** `baseUpdatedAt`.
6. **Reload while still offline.** ⭐⭐ *This is the step that went red on
   2026-09-09.* Read all three layers again, and read the header text.
7. Go back online. Expect exactly one PUT carrying the CAS baseline, then
   `dirty:0` re-based on the new `updatedAt`.
8. Clean up: soft-delete the note, confirm all four stores are `0`, `0` locks,
   and set the key back to `'0'`.

Read all three layers in one go:

```js
const id = '<note id>', acct = '<account id>';
const db = await new Promise(r=>{const q=indexedDB.open('uct_notebook_'+acct);q.onsuccess=()=>r(q.result)});
const rd = s => new Promise(r=>{const t=db.transaction(s,'readonly').objectStore(s).getAll();t.onsuccess=()=>r(t.result||[])});
console.log(JSON.stringify({
  draft: JSON.parse(localStorage.getItem('uct.j2.notedraft.'+id) || 'null'),
  note:  (await rd('notes')).filter(n=>n.noteId===id),
  outbox:(await rd('outbox')).filter(n=>n.noteId===id),
  headerText: document.body.innerText.match(/waiting to sync|Reconnecting|Save failed/g),
  editorMounted: !!document.querySelector('input[placeholder="Title"]'),
}, null, 1))
```

⛔ **RED if:** any layer holds an empty document · the header does not say
"waiting to sync" · the editor did not mount. ⛔⛔ **A `null` or `''`
`baseUpdatedAt` is a NEW FINDING** — say so loudly; it is not the old one.

## ⚰️ What did NOT run — **SUPERSEDED: both halves ran on 2026-09-10**

⛔ **Kept as the record of why a session STOPPED rather than improvised.** The two
items below were true when written and are not true now: the owner amended the
script to permit CDP, a second Chrome with its own profile was stood up, and
Part A and Part B above are the result. Read this for the reasoning, never for
the status.

- **Steps 7–9 (offline → type → reload → read all three layers).** This is *the
  step that originally went red*, and it needs the network killed from DevTools.
  That is not drivable from the automation available here, and substituting a
  `fetch` stub would be a different experiment wearing the canary's name — the
  script of record says DevTools offline, and improvising on it is exactly what
  the script-of-record ruling forbids.
- **The conflict path**, which needs a second signed-in context.

⚰️ It then read: *"Both need a person at the keyboard for about five minutes.
Until they run, the canary is partial and the seven-day observation window stays
unstarted."* **Both ran; the canary is complete; the window is open.**

# ⏱️ THE SEVEN-DAY OBSERVATION WINDOW — STARTED 2026-09-10

| | |
|---|---|
| start | **2026-09-10** (canary green, deploy `cd674ef56` live) |
| end | **2026-09-17** |
| state | `OFFLINE_DEFAULT_ON = false` — **the window observes the DEPLOYED FIX, not the offline layer** |

**What is watched, and what each would mean:**

1. **Any member report of a note reading blank after a reload.** The defect this
   deploy fixes. One report ⇒ stop and re-open, do not explain it away.
2. **Any `null` or `''` `baseUpdatedAt` in any artifact.** ⛔ That is a **NEW
   FINDING**, not the old one — the old one is fixed at source, railed at the
   server, and refused at the drain. Say so loudly.
   ⭐ **This one no longer depends on somebody noticing.** The drain reports its
   own refusal as `notebook_blocked_no_baseline` (Item 2 below); read it with
   `GET /api/admin/activity` and look for `j2:notebook_blocked_no_baseline`.
   ⛔ It only counts once the instrument is on `master` — until then the number
   is "not measurable", not "zero".
3. **The inherited-red ledger** — same nine rows, no new offenders. Re-check on
   any master merge that touches `app/` (tier 2).
4. **The drain**, once the flag is ever on: `(conflicted copy)` creation rate and
   any `permanent:true` outbox entries.

⛔ **The window is not a reason to flip the flag.** Flipping is a separate
decision against the gate below.

## 📋 THE WINDOW-WATCH LOG — one row per check, stamped in UTC

⛔ **Three checks, and the schedule is the owner's:** today (open), once
mid-window, and at close. ⛔ **Record a check even when everything is
unchanged** — a log with only interesting entries cannot distinguish "quiet"
from "nobody looked" (`lesson_uptime_is_not_a_sleep_signal_during_deploy_churn`,
in log form).

### Check 1 — **2026-09-10T04:16:51Z** (window opens)

| what | reading | |
|---|---|---|
| deploy `cd674ef56` still an ancestor of `master` | **YES**, `master` = `f58383e69` | ✅ |
| `OFFLINE_DEFAULT_ON` on the LIVE bundle | **`false`** — `assets/NotebookTab-CMePJ5Sn.js` compiles it to `const zi=!1`, returned whenever the opt-in key is unset. The fix is live in the same chunk (`Ue` = `usableBaseline`). | ✅ |
| Item-2 events fired | **0, by construction** — the instrument is on the branch, NOT on `master`. Until it deploys, "zero occurrences" means "not yet measurable", not "measured zero". ⛔ Do not read the first deployed check as a continuation of this row. | ⚠️ |
| member reports of an empty document | **none reached this session** | ✅ |
| inherited-red ledger | **UNCHANGED** — the same 8 files fail the full frontend suite after merging `origin/master` (`f58383e69`); no new offenders, nothing inside `journal-2-0` | ✅ |
| production Notebook end state (4 stores 0 · 0 locks · key `'0'`) | ⛔ **NOT RE-DRIVEN — and it cannot be, as written.** See below. | ⛔ |
| `/api/health` | `ok`, `uptime_seconds` 3264 (≈54 min). Not a deploy: `master` has not moved and the bundle hashes are byte-identical to the canary's. | ✅ |

⛔ **Why the production-store row is honest rather than green.** That reading
needs an AUTHENTICATED browser session against production, and the rig that took
it is fully torn down — deliberately, and verified. Its profile directory is one
of the two leftovers below. **A fresh profile would not be signed in, and this
session does not enter credentials.**

⚠️ **And the target was per-profile anyway.** `key '0'` was `localStorage` in the
canary rig's own Chrome profile; that profile no longer runs. A new browser
would read the key **unset** — which is production's default and equals off, but
is a *different reading*, not the same one confirmed again. ⛔ Re-stating `'0'`
here without a browser would be inventing a measurement.

**To close this row on the next check**, the owner stands up an authenticated
session (or says to build the CDP rig again and signs in, exactly as on
2026-09-10) and the check reads: four stores 0 · 0 `uct.nb.sync.*` locks · the
opt-in key unset-or-`'0'`.

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
| A blocked entry is surfaced to the member | ✅ **CLOSED 2026-09-10** — the notes list (both views) and the open note's header now say it, in the shipped vocabulary, and the sentence names the ACTION. See below. |
| ~~`baseUpdatedAt: null` explained~~ → **`null` INSTRUMENTED, zero occurrences in the window** | ⏳ **INSTRUMENT LIVE 2026-09-10, count starts at 0** — the condition CHANGED, deliberately; see below |
| A fresh §15 canary on the deployed fix | ✅ **COMPLETE — 2026-09-10.** Online half (happy path + the fix's own signature) and, via the CDP rig, the offline half incl. **the 9/9 red step** and the conflict path through the drain's fork. All green. No `null`/`''` baseline anywhere. |
| Seven-day observation window armed | ✅ **STARTED 2026-09-10, ends 2026-09-17** — see below |

### The blocked-entry finding, in full (measured, `blockedEntryIsVisible.test.jsx`)

| question | answer |
|---|---|
| Are the member's words intact? | ✅ every word, on disk; the record stays `dirty: 1`; the outbox keeps the full patch |
| Is the block recorded? | ✅ `permanent: true` + a readable `lastError` naming the missing baseline |
| What does the save indicator show? | ✅ **on the open note, honestly** — "Reconnecting…" plus "Saved on this device/in this browser · waiting to sync". Asserted as rendered TEXT, not state. |
| Do later writes for that note still drain? | ✅ **a later edit UN-BLOCKS it.** The outbox is keyed `note:<id>`, so a fresh durable write replaces the entry and the replacement carries no `permanent` flag. A hold, not a dead end. |
| Does it wedge other notes? | ✅ no — another note still sends (`blocked: 1, sent: 1`) |
| Does it retry itself? | ❌ no, by design — that is the point of the refusal |
| **Is it surfaced anywhere else?** | ✅ **YES, since 2026-09-10** — it was ⛔⛔ **NO**. See the section below. |

⚰️ **That last row used to read: "`summarize()` has ZERO consumers in the app and
`BLOCKED` appears in no component — for a note the member is not looking at, the
hold is completely silent."** The words were safe and the hold was recoverable,
but only by a member who happened to edit that note again, for a reason nothing
on screen ever gave them. It was the last open row of this gate.

---

## ✅ ITEM 1 — THE BLOCKED ENTRY IS SURFACED (closed 2026-09-10)

**What a member now sees, as rendered text.**

| where | what it says |
|---|---|
| Notes list — **card grid** | a warning-toned chip on the note's meta row: **"Edit again to sync"** |
| Notes list — **table view** | the same chip, beside the title |
| Either badge, on hover | **"This note has words that have not reached the server, and will not until you edit it again."** |
| The **open note's** header | **"Saved on this device · edit it again to sync"** (or "in this browser" — the noun narrows exactly as it already did) |

⭐ **The sentence names the ACTION, not the state.** "Not synced" tells a member
something is wrong and nothing about what to do. A later edit is what un-blocks
it — the outbox is keyed `note:<id>`, so a fresh durable write REPLACES the
entry and the replacement carries no `permanent` flag — so the copy says that.

⛔ **ONE VOCABULARY, ONE AUTHORITY.** The strings live in
`lib/offline/unsyncedCopy.js` and nowhere else; the editor header stopped
inlining them. Two surfaces describing one state in two vocabularies is how a
member learns to read them as two different states.

⛔ **THE OPEN NOTE WAS ONLY HALF-HONEST.** Its existing "waiting to sync" line is
gated on the editor's own save attempt (`error`/`reconnecting`). A note blocked
in a PREVIOUS session and opened today is neither, so the one surface that was
described as honest said nothing in exactly the case that matters. The blocked
line is not gated on the save attempt, and it wins over the "waiting" line —
two lines at once would read as two states.

**Mechanism.** `lib/offline/blockedNotes.js` reads the ONE predicate the drain
already persists (`permanent === true`) — it does not re-classify, because a
second copy of "what counts as blocked" would disagree the day a third block
reason lands. `lib/offline/useBlockedNotes.js` is the hook, **behind the same
gate as the drain**: with `OFFLINE_DEFAULT_ON` false it opens no database and
reads nothing, so this surface is not the one place the dark wave touches
IndexedDB.

**Rails** — `lib/offline/blockedNoteSurface.test.jsx` (11) +
`lib/offline/blockedEntryIsVisible.test.jsx` (rewritten: the pin that recorded
the gap is replaced by an assertion that reads the surface, plus a no-cross-talk
control). Every assertion is rendered TEXT. Controls: a still-retrying entry
says nothing · an empty outbox says nothing · the flag off says nothing · no
cross-talk between notes. Mutation-proved four ways, each hitting exactly one
test: cut the card wire · cut the table wire · widen the predicate · swap the
copy. ⛔ The table assertion is driven through the tab's own **Table view**
button, because a component test rendering `NotesTableView` directly is
structurally blind to a severed wire.

---

## ⏳ ITEM 2 — THE `null` IS INSTRUMENTED, NOT HUNTED (live 2026-09-10)

⛔ **THE GATE CONDITION CHANGED, ON PURPOSE.** It was *"`baseUpdatedAt: null`
explained"*. Nine paths were driven trying to reproduce it and none did; a tenth
guess is not evidence, and an unfalsifiable item cannot gate anything. It is now:

> **`null` instrumented; ZERO occurrences during the observation window.**

**What fires.** When the drain refuses a baseline-less entry it now emits ONE
structured event — `notebook_blocked_no_baseline` — to
`POST /api/j2/telemetry`, the Notebook's existing allow-listed client→server
channel (already used by this tab for `notebook_tab_visit`). It lands in
`activity_log` and is read back with `GET /api/admin/activity`.
⚠️ Stated plainly: that is a **telemetry** sink, not an error pipeline. This app
has no client error pipeline, and inventing a transport was not the smallest
thing that works.

**What it carries** — exactly seven fields, pinned as a SET, never note content:
`noteId` · `generation` · `sessionId` · `baseline` · `entryAgeMs` · `attempts` ·
`flag`.

⛔ **The baseline is DESCRIBED, never sent raw**: `null` · `undefined` ·
`empty-string` · `whitespace` · `non-string:<type>`. Every value that reaches
the reporter has already failed `isUsableBaseline`, so the shape is strictly
more information than the value — and it is the one field through which a
member's words could ever ride along if a future bug put text there.
⭐ `null` and `empty-string` stay distinguishable: they are two different
defects (the incident, and the `??`-vs-truthiness bug found hunting it).

**What does NOT fire** — and each has its own rail: a sent entry · a transient
failure · a 409 that forks · a non-transient rejection (blocked, but with a
`lastError` a human can already read) · **a re-drain of an already-blocked
entry**. That last one is load-bearing: the `permanent` branch runs before the
baseline check, so the event marks the TRANSITION into blocked, once. Without
it the retry interval would manufacture an occurrence every tick and the window
would read as a storm of incidents that never happened.

**Rails** — `lib/offline/blockedBaselineEvent.test.jsx` (17) +
`tests/test_j2_telemetry_allowlist.py` (8, the server-side mirror: a client rail
proving "we posted it" is green against a server that 400s every one). The event
name is DERIVED from the client source in the backend test rather than retyped.
Mutation-proved: delete the hook's reporting loop → the wire test alone goes
red; remove the name from the server allow-list → the two acceptance tests go
red while the "it is still an allow-list" control stays green.

⛔ **The instrument cannot break what it measures.** A reporter that throws
leaves the queue settling exactly as it would have — railed.

---

## ⛔ ITEM 3 — KNOWN LIMITATIONS (write these down; do not "fix" them)

### An offline reload cannot load the Notebook at all

Wave Q1 has **no service worker**, deliberately, and the owner's standing
constraint is that it stays untouched. So a page reload while the network is
down cannot fetch `index.html`: the SPA never loads, the browser shows its own
error page, and from that context storage is not even readable (`draft:"ERR"`,
`dbMissing:true` — measured 2026-09-10 through the CDP rig).

**Nothing is lost.** The words are in IndexedDB, in the outbox, and in the
localStorage draft; the next load with a network present finds all three. What
is *unavailable* is the app, for as long as the network is down and the page has
been thrown away.

⛔ **This is an EXPECTED OBSERVATION, never a red**, and the §15 script now says
so at step 9. It is also not an argument for a service worker: that is a
separate decision, with its own cache-invalidation and update-path costs, and
proposing one is out of scope here.

### The drain never touches the note that is open

`excludeNoteId` hands the open note to the editor, never to the sweep — two
writers on one note is the last-write-wins this wave exists to forbid. A queued
entry for the open note waits until the member accepts the recovery banner,
edits, or **navigates away**. A reading that looks like a stalled drain is the
design working.

### A blocked entry is a HOLD, and only the member can release it

By design it is never retried. The surface built for Item 1 is what makes that
survivable; without it the hold was silent, which is why it gated the flag.

---

## 📣 THE MEMBER-IMPACT PARAGRAPH **FOR THE FLAG FLIP**

⛔ **This is NOT the deploy's paragraph** (that one is §(a), and it says
"nothing about this changes what a member sees"). This one is for the decision
that has not been made: turning `OFFLINE_DEFAULT_ON` to `true`. Written now, in
plain language, so the flip is judged against what a member would actually
experience rather than against a description of the code.

**What a member would get.** Your notes keep working when your connection
drops. What you type is written to a durable copy in your browser as you go,
queued, and sent when you are back. If two devices edit the same note while one
is offline, neither version is thrown away: the server keeps the one that
arrived first, and yours is saved beside it as a note titled "(conflicted
copy)".

**What a member would see that is new.**
- A line in the note header while work is unsent: **"Saved on this device ·
  waiting to sync"** — and **"Reconnecting…"** while it retries.
- Occasionally, on a note in your list: **"Edit again to sync"**. That means we
  are holding words that never reached the server, and we have deliberately
  stopped retrying because sending them could have overwritten a newer version
  from another device. Your words are safe; opening the note and editing it
  releases them.
- Sometimes, a real note in your library ending in **"(conflicted copy)"**.

**⛔ The one thing that will surprise people: reloading while offline shows the
browser's error page.** Not a blank note — the app itself does not load. UCT
Intelligence has no offline app cache, so if you lose connection and then
refresh the tab, you get your browser's "no internet" screen until the
connection is back. **Nothing you wrote is lost**: everything typed offline is
still there the next time the page loads with a connection. But "offline
editing" means *keep typing in the tab you already have open*, not *use the app
with no internet*. If that gap matters to members, it is a service-worker
project and a separate decision — it is not part of this flip.

**Blast radius if the flip is wrong.** Every Notebook user, every note, and the
failure mode is data-shaped rather than loud: the 2026-09-09 activation went
wrong in twenty-five minutes and the symptom was a note reading blank. That is
why the flip has a gate, why the gate is not the deploy's gate, and why the
observation window watches the deployed fix first.

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
- ⛔⛔ **RUN THE WAVE'S GATE AT REST — NEVER full-suite-then-journal-2-0.**
  That ordering manufactures failures that say nothing about the code. Under
  sustained load a **population** of journal-2-0 tests times out — three
  different ones observed (`ImportWizard` audit-B1 4.2s · `captureConvergence`
  **28.7s** · "closing returns the dialog to nothing" 4.1s) — and it is whichever
  test happens to be slowest, not a specific flaky file. Naming one of them
  would be false and "fixing" it would move the failure
  (`lesson_an_intermittent_red_can_be_a_population_not_a_test`). journal-2-0 is
  **2391/2391 in eleven consecutive runs at rest**. Ledger row 9.
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

- ⚠️ **`.worktrees/canary-chrome-profile` — ~1,700 files, needs a manual delete.**
  The CDP rig's throwaway Chrome profile. The browser itself is fully torn down —
  0 canary-profile processes, CDP endpoint gone, `chrome.exe` back to its baseline
  15, only the owner's browser (`44184`) left — but Windows still holds a handle
  on the profile directory. Gitignored; cannot reach a commit or a deploy.

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

  ⭐ That one command clears both leftovers — the whole `.worktrees` directory is
  gitignored and holds nothing but throwaway rigs.

  ### ⛔ THE OWNER RUNS THESE. This session does not.

  Both directories are held open by a Windows handle, and **which process holds
  it is not knowable from here** — killing a guess is how another workstream
  loses its work (`feedback_agent_authority_and_worktree_isolation`).

  ```
  # 1. See what is holding them (Sysinternals handle.exe, if installed):
  handle64.exe -nobanner "C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees"

  # 2. Delete both leftovers — ONE command, the whole directory:
  cmd /c "rmdir /s /q C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees"

  # 3. Confirm it is gone (prints nothing if clear):
  cmd /c "dir /b C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees" 2>nul
  ```

  ⛔ If step 2 reports *"The process cannot access the file"*, the holder is still
  running — that is information, not a reason to force it. ⛔ Do NOT
  `git worktree remove`: the registry is already pruned; only the directories
  remain. Nothing here is tracked, so neither can reach a commit or a deploy and
  neither is urgent.

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
