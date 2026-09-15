# The five RED append cells — investigation handoff

**Opened 2026-09-14, after Q1 fix 4 shipped to production and did NOT close them.**
Written for a session with zero context. Nothing here has been investigated yet.

---

## 0. ✅ RESOLVED — Q1 fix 5, `1cf7b8c1d` (shipped `1ceb3c5c2`, deploy `b774aaa2`)

**Cause found: the supersede decision compared CLOCKS, not content.**
`outboxDrain.js:466` cleared a queued entry when
`isSupersededBaseline(entry.baseUpdatedAt, landedBaseline(noteRec))` — which is
`ta < tb` over two timestamps and nothing more — then reported *"a save this
browser landed is newer"*, which a reader takes to mean **the server already has
these words**. It never asked whether that landed save contained them.

```diff
-    if (isSupersededBaseline(entry.baseUpdatedAt, landed)) {
+    if (isSupersededBaseline(entry.baseUpdatedAt, landed)
+        && sameAuthoredContent(noteRec, entry.patch)) {
```

⭐ **Why fix 4 did not cover it.** `landedBaseline` refuses a DIRTY record, so
while the editor is mounted the invariant holds. Fix 4 keeps a record with unsent
work dirty — **but only where fix 4 decides.** The append door reconciles the
record clean by another path, so it arrived here with the protection already gone.
**Fix 4 was necessary and not sufficient.**

### Which hypotheses this settles

| # | hypothesis | outcome |
|---|---|---|
| 1 | the door never enqueues the typed words | ⛔ **KILLED** — the trail shows `sentenceInQueuedEntry: True` at queue time |
| 2 | the door settles the note from the server's post-embed copy | ⛔ **KILLED** — `settleNoteWrite` *only* records the revision; it never touches body, dirty flag or intent |
| 3 | the three `→None` PUTs consume the entry | ⛔ **KILLED** — the entry survived those; it was cleared later, at the supersede check |
| 4 | the `+SENT` marker is trusted as delivery | ⛔ **KILLED** — the clear happened on the baseline comparison, before any marker was consulted |
| 5 | ordering-independent, so not a race | ✅ **CONFIRMED, and it was the tell** — a clock comparison is ordering-independent by construction |

### ⛔ Correction to §2 below

*"the door fires at call #7"* was **never a defect indicator** and should not have
been carried as one. Call #7 is the door's own `POST /embeds`; the rig counts it to
establish ordering, so *"sends carrying the sentence **before** the door: 0"* is
true **by construction**. The single real symptom was **zero successful sends
carrying the sentence at all**, which fix 5 explains completely: the entry was
cleared before any send ran (`clearOutboxEntry` then `continue`, skipping the
`send(entry)` block).

### Rails and mutation proof

`supersedeProvesContent.test.js` — written 2026-09-13, carried as the `expected_red`
reproduction, went **1 failed → 3 passed**.

⚠️ **Fix 5 shipped with no NEW rail**, because its reproduction already existed and
predated it. Mutation-proved afterwards rather than at commit time, which is the
weaker order and is recorded as such:

```
MUTATED  (content proof removed, clock-only restored)
  FAIL supersedeProvesContent.test.js > ⛔⛔ DOES NOT discard the member's words
       when the landed save lacks them
  Tests: 1 failed | 2 passed (3)      exit 1   <- the rail FIRES
RESTORED (captured bytes written back, byte-for-byte, never git checkout)
  Tests: 3 passed (3)                 exit 0   <- quiet
```

⭐ The first attempt at that proof **failed to mutate at all** — the match string
was LF-joined against a CRLF file — and printed `3 passed`, which would have read
as a passing mutated run. Two assertions caught it (`guard not found verbatim`,
then `nothing was mutated`). **A fixture that cannot create the failure is not a
test**, and that is the third instance of this shape in one session.

### Still outstanding

- ⛔ **The production re-run of the five cells against fix 5 has not been reported
  yet.** Until it is, fix 5 is proven at unit level and on the wire-trace reasoning,
  **not** on the rig. R-1a's flip stays HELD.
- ⛔ **2.8b never ran** — the remount-with-server-moved-on scenario, fix 4's own
  production proof. Run it FIRST in the next window.

---

## 1. The symptom, in one paragraph

A member drives an **append door** (`Send to Journal → Current note`, from a
`/charts` widget) while offline, having typed words into the note. The appended
node — the widget embed — reaches the server. **The member's typed words do not.**
The durable record then goes clean and un-queued, so the "edit it again to sync"
surface never flags it and nothing offers the words back. This is the *same
symptom* Q1 fix 4 was built for — unsent member work discarded without the server
ever holding it — reached by a **different route**. Fix 4 closed the settle-side
and store-side discard, which is why all 24 metadata-door cells are GREEN; the
append path loses the words somewhere else.

---

## 2. The trail, verbatim

Rig profile used (the ONE signed-in profile, never recreated):
`C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome-profile-persistent`

Run: `2026-09-15T03:23:34Z`, against production on the deployed bundle carrying
fix 4 (`85e68247c`, Railway deploy `f15cb9c5`, web SUCCESS 22:05:50 CT).

### Verdicts

| family · ordering | verdict |
|---|---|
| `append_widget_embed` · settle-first | **N/A** — the product cannot reach this state; an append door records a landed revision and never settles with local state (`f5Freeze.test.js` asserts it from the source) |
| `append_widget_embed` · drain-first | 🔴 **RED** |
| `append_widget_embed` · marker LIVE | ⚠️ **INCONCLUSIVE** — outbox still held the entry after 120.0s; the drain had not finished, so a server read would measure the clock, not the product. *Not "lost"; not yet delivered.* |
| `append_widget_embed` · marker EXPIRED | 🔴 **RED** |
| `append_widget_embed` · slow PUT (landed, ring populated) | 🔴 **RED** |
| `append_widget_embed` · reload mid-flight (marker from a dead tab) | 🔴 **RED** |

### One cell in full — `slow PUT`, note `fd9e52863ca6474cabf0a4218482800c`

```
queued: {'entryStatus': None, 'entryAttempts': None, 'entryError': '',
 'entryKeys': 'mutationId,noteId,kind,patch,baseUpdatedAt,generation,sessionId,queuedAt',
 'locksHeldPending': '1/0', 'lockClaimable': True, 'onLine': False, 'outboxTotal': 2,
 'queuedForThisNote': 1, 'sentenceInDurableCopy': True, 'sentenceInQueuedEntry': True,
 'sentenceOnScreen': True, 'baseUpdatedAt': '2026-09-15T03:30:30.457416+00:00', 'dirty': True}

arranged: {'ok': True, 'arranged': 'landed ring carries the revision + an expired marker',
 'baseUpdatedAt': '2026-09-15T03:30:30.457416+00:00',
 'marker': {'sessionId': 'gone', 'startedAt': 1789443040596,
            'baseUpdatedAt': '2026-09-15T03:30:30.457416+00:00'},
 'ring': ['2026-09-15T03:30:30.457416+00:00']}

offline nav: {'path': '/charts', 'search': '', 'editor': False, 'offline': True}
door: {'ok': True, 'via': 'Send to Journal → Current note'}

store trail (queued, dirty, base, sentence-in-record):
    [(1, True, '16+00:00', True), (0, False, 'None', False)]

drain: emptied after 12.5s
looking for: "F5-MATRIX append_widget_embed slow PUT 2026-09-15T03-23-34Z the member's offline words"
stem 'F5-MATRIX' present: True · 'offline words' present: False

wire: POST /→200
    · POST /fd9e52863ca6474cabf0a4218482800c/opened→200
    · PUT  /fd9e52863ca6474cabf0a4218482800c[35+00:00]→200
    · POST /fd9e52863ca6474cabf0a4218482800c/opened→200
    · PUT  /fd9e52863ca6474cabf0a4218482800c+SENT[16+00:00]→None
    · PUT  /fd9e52863ca6474cabf0a4218482800c+SENT[16+00:00]→None
    · PUT  /fd9e52863ca6474cabf0a4218482800c+SENT[16+00:00]→None
    · POST /fd9e52863ca6474cabf0a4218482800c/embeds→200
    · POST /fd9e52863ca6474cabf0a4218482800c/opened→200
    · POST /fd9e52863ca6474cabf0a4218482800c/images→200
    · PUT  /fd9e52863ca6474cabf0a4218482800c[02+00:00]→200

the door fired after call #7; successful sends carrying the sentence before it: 0
forks: 0 · outbox left: 1 · conflicts: 0 · left the note: True · 64s
⇒ RED  offline sentence in the server body: False · appended node present: True
```

### The other cell ids, same run

`6a0ec961b6e340f7a59daaae63f17c5e` (drain-first) ·
`de2d36140f4746e09884552dfc1f40ac` (marker LIVE, INCONCLUSIVE) ·
`c0e24eeb0a334ac99192de7eaf980fce` (marker EXPIRED) ·
`4a4b8522b68747d6b86233ceb248ac43` (reload mid-flight)

⭐ **The shape is identical in all four REDs**: three PUTs carrying the sentence
return `None` (offline), the door fires at call #7, **zero** successful sends
carried the sentence before it, and the record transitions
`(queued=1, dirty=True, sentence present) → (queued=0, dirty=False, sentence gone)`.

---

## 3. A1–A3, answered from evidence

### A1 — 2.8b did NOT run. The DEPLOY row is incomplete.

The remount-with-server-moved-on scenario was specified to run **first** in the
rig window, before the five cells. It did not run: the window was spent going
straight to `--family append_widget_embed`. Measured, not recalled — the run log
contains **0** occurrences of "remount".

⛔ **Fix 4's own production proof is therefore still outstanding.** The DEPLOY row
for `85e68247c` cites 2.8a (CLEAN) and explicitly marks 2.8b pending. The next
session should run it and append the evidence to that row.

### A2 — PRE-EXISTING, not a regression. No rollback lever is pulled.

These cells were already RED on this same route **before** fix 4 shipped.

- Commit `43fcb9152` — *"F5 table: append_widget_embed is RED on ALL FIVE
  applicable orderings"* — predates fix 4.
- The matrix as of `73595654b` (pre-re-run) reads
  `| append_widget_embed | — n/a | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |` with baselines
  `2026-09-14T05:18:53` … `05:44:09`, all before fix 4 deployed
  (`2026-09-15T03:02Z`).
- The trail is **byte-for-byte the same shape** pre- and post-fix: same
  `store trail: [(1, True, …, True), (0, False, 'None', False)]`, same
  `sends before the door: 0`.

⭐ **Consequence:** 2.1's Lever 2 signals are not in play. Lever 2 exists for a
failure *inside the fix-4 diff*; this is not one. **No rollback is pulled, and
pulling one would reinstate a real data-loss bug for no benefit.**

⚠️ Two differences worth noting, neither a regression: `outbox left` went 6 → 0/1,
and `marker LIVE` moved RED → INCONCLUSIVE (the drain had not finished within
120s). The INCONCLUSIVE is a *measurement* difference, not a product one — do not
read it as an improvement.

### A3 — Blast radius: a REAL member surface, and the loss is silent.

The door is `Send to Journal → Current note`, reachable from `/charts` widgets —
`AiSearchWidget.jsx`, `AlertsWidget.jsx`, `BreadthWidget.jsx`, `CalendarWidget.jsx`
and others, plus `pages/breadth/drill/drillWorkspace.js`. Wave Q1 is **live for
every member** (`notebook_offline_default_on: True`, verified on production
2026-09-14).

**What the member sees:** the embed they sent appears in the note and reaches the
server. Any words they had typed while offline are **gone from the server**, and
because the local record goes clean and un-queued, nothing marks the note as
pending and no recovery surface offers the words back. There is no error and no
banner. **It is silent.**

**Does fix 4 make it better, worse, or unchanged?** **Unchanged** on this route —
the trail is identical before and after. Fix 4 is strictly an improvement
elsewhere (24 metadata cells GREEN) and neither helps nor harms here.

---

## 4. What fix 4 shipping RULES OUT — do not re-investigate these

- **The settle-side remount discard.** `settleLandedSave`'s `unsentWork` guard is
  live on master (6 references in `origin/master:useDurableNote.js`). A dirty
  record is no longer reconciled clean on remount.
- **The store-side null-intent delete.** `putNoteWithIntent`'s dirty guard is on
  master and now rails at its own layer
  (`remountNeverDiscardsUnsent.test.js`). ⚠️ It was decoration until the gauntlet's
  M29 caught it — removing it reddened nothing.
- **A deploy-level fault.** 2.8a is CLEAN: 985 status-bearing lines in the first
  15 minutes post-boot, **all 2xx**, none ≥ 500, over an EXACT 2,780-line pull
  read by structured field.
- **The metadata doors entirely** — `folder`, `ticker`, `tags`, `hero`: 24/24 GREEN.

⛔ The remaining defect is in the **append** path specifically, between the door
firing and the drain, and it predates fix 4.

---

## 5. Reproducing ONE cell end to end

```sh
# the ONE signed-in profile — never create a new one, a fresh profile is SIGNED OUT
python tools/q1_f5_matrix.py \
  --family append_widget_embed \
  --ordering "slow PUT" \
  --profile "C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome-profile-persistent" \
  --out docs/notebook/wave-q1-f5-production-matrix.md
```

**Window constraints.** `UCT-WaveQ1-Observe` runs every 2 hours. The guard
(`q1_f5_matrix.rig_window_refusal`) refuses if a Q1 task is due within 60 min, is
Running, or STARTED within `JUST_RAN_COOLDOWN_SECONDS = 180`. Usable window is
roughly **60–90 minutes** between observer runs. Ask the guard, never the clock:

```python
import datetime as dt; m.rig_window_refusal(dt.datetime.now())   # None == CLEAR
```

⛔ **Rig hygiene, and the tool will warn you:** its opt-out restore can fail to
reach disk — a documented race where a `localStorage` write followed by an
immediate kill-by-marker is lost. If it says *"THE RIG IS NOT OPTED OUT"*, redo it
through `window_check.opt_out(page)` (its own function, never a second copy),
which forces a flush via a document running no app code, then verify **on disk with
the browser dead**. An opted-in rig gives the sampler a non-zero outbox and the
Sunday gate reads that as product state.

---

## 6. Hypotheses, ranked — NOT investigated

Each names the single observation that would confirm or kill it.

1. **The door's own write path never enqueues the typed words.** The embed POST
   (`/embeds`) and the note PUT are separate; the door may send the embed and
   settle the note from server-derived state without ever queueing the editor's
   buffer.
   *Confirm/kill:* does the outbox entry that exists at `queued:` time still exist,
   with the sentence, immediately **after** the door fires and before the drain runs?

2. **The door settles the note from the server's post-embed copy.** `/embeds`
   returns 200 and the server's revision moves; if the door then treats that
   revision as "landed" it can clear the record exactly as the pre-fix-4 settle did
   — the same mechanism one layer out, which fix 4 did not reach.
   *Confirm/kill:* is `settleNoteWrite` (not `settleLandedSave`) called on the
   `/embeds` response path, and does it pass server state as `acked`?

3. **The three `→None` PUTs consume the entry.** Three sends carrying the sentence
   all fail offline. If a failed send removes or blanks the entry rather than
   retrying it, the words are gone before connectivity returns.
   *Confirm/kill:* `entryAttempts` is `None` in the trail — does the drain
   increment attempts on a `None` response, or take a removal branch?

4. **The `+SENT` marker is being trusted as delivery.** The wire shows
   `PUT …+SENT[…]→None` — a marker raised before a send that never completed.
   *Confirm/kill:* does any path treat marker-raised as sent when the response is
   `None`?

5. **Ordering-independent by construction, so it is not a race.** All four REDs
   fail identically across four different arranged orderings.
   *Confirm/kill:* if a hypothesis above explains only one ordering, it is not the
   cause.

---

## 7. Standing rails the next session inherits

- **Read the manifest, not the exit code.** The task wrapper reported exit 0 for a
  gate that printed `1 NEW failure` *and* for one that printed
  `GATE INVALID: TREE DRIFT`. Uninformative in both directions.
- **Hand-read AND the fixed exit code on every manifest; they must agree.**
- **The gate judges the tree you push.** Never edit the repo mid-gate — that
  voided two runs in one session.
- **Both diff forms before a push.** Three-dot = what I changed; two-dot = has
  master moved. Fast-forward is answered from the two-dot.
- **Name tests by NODE ID, never `-k`.** A `-k` filter once selected a
  pre-existing unrelated test, missed one of three, and still totalled 3.
- **Regenerate, never `git checkout`**, and refuse when content matches neither
  captured nor mutated state.
- **Non-vacuity control on every rail** — a control that re-implements the
  predicate agrees with itself (R-05); share one predicate.
- **Clock guard:** master pushes refused 09:25–16:05 ET on a trading day.
  `UCT_DEPLOY_WINDOW_OVERRIDE` is logged and is not for convenience.
- **One gate at a time on this box.** Three concurrent gates once swept a
  worktree's `node_modules` to zero and destroyed its `.git`.
- **Classify a NEW failure by direction, and re-run a load-sensitive name alone**
  before treating it as a regression. Never bank a load-sensitive name.

---

## 8. Phase 3 backlog — DEFERRED, not dropped

Order: **1.B → four CRITICALs → HIGHs → 3.C → Task 5 → closing gate → 3.F.**
Push as **one batch**, tonight after fix 4 or after 16:05 ET.

| # | item | spec |
|---|---|---|
| 1.B | `tests/test_nb_gate_trigger4_ownership.py` | delete `_buckets` (`:114-123`), drive `gate.main()`, assert on `verdict.md` at 140/165/203/213/244. Prove with the harness: mutate `tools/nb_gate.py:714` to `in ('foreign','unknown')` → file RED → restore → green. The harness is hardwired to `gate-baseline.json`; parameterise the target file as its own commit first, then re-run Acceptance 1 once. |
| 3.A | `docs/discord-render/instruments/pod_upload.sh` | `set -euo pipefail`; trap cleanup of the partial `.b64` **on the pod**; compare local vs remote sha and fail on mismatch; no `echo`/`tail` as the last status |
| 3.A | `tools/_mutate_partner_fixes.py` | restore in `finally`/trap (pattern: `tools/mutation_check.py:161-164`) |
| 3.A | `tools/flipc_variant_patch.py` | `--revert` regenerates from a captured per-file copy taken at apply time, reverts ONLY the applied variant's files, refuses any file matching neither captured nor variant content. **Negative test:** apply a one-file variant, dirty `StockChart.jsx` with an unrelated edit, `--revert`, assert the dirty edit survives |
| 3.A | `tools/_mutate_path_risks.sh` | trap; `ROOT` from `git rev-parse`, never hardcoded; fix the `:54` literal |
| 3.B | `tools/flow_worker_watch_coverage.py` | "nothing to judge" and "could not resolve a base" must not be the same sentence + exit 0 |
| 3.B | `tools/_mutate_coach_chat_timeouts.sh` | `trap 'restore' EXIT INT TERM` — `restore()` exists and is correct, nothing binds it |
| 3.B | `tools/activate_notion_connector.sh` | trap that unsets the first Railway var on non-clean exit |
| 3.B | `docs/discord-render/instruments/step3_real.sh` | `--deliver-channel` with no id yields a non-empty flag string; the banner collapses two facts |
| 3.C | `tools/hub_trace_analyze.py` | `self_check()` must import `report()`'s bucketing + `FLICK_MS` instead of re-implementing them |
| Task 5 | `scripts/gate_shards.py` | promote `unexplained()` out of the test file; the gate refuses to start on an unexplained `expected_red`, naming the entry; `tests/test_gate_shards.py:651` imports it; the control keeps both directions; mutation proof re-run |
| 3.E | — | one closing gate, read by hand AND by the fixed exit code; both must agree |
| 3.F | — | restore CI visibility: install `gh` or fix the GitHub MCP `Authorization` header (the unexpanded `${GITHUB_PERSONAL_ACCESS_TOKEN}` signature). Lowest priority |

⛔ **The W.2 / W.3 patch drafts were never written.** They were scoped to be
drafted in scratchpad while a gate ran; that time went to R1–R3 and the push
instead. The specifications above are complete enough to work from, but **there is
no draft code to copy**, and `docs/notebook/phase3-drafts/` is deliberately not
created rather than created empty. Stating this rather than leaving a reader to
discover it.
