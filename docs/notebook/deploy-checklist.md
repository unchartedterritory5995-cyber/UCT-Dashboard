# THE DEPLOY CHECKLIST — the single authority

⚰️ **WHY THIS FILE EXISTS.** The standing deploy authorisation has been
"conditional on a checklist" since the charter, and until 2026-09-11 that
checklist existed only in prose, in conversation, re-derived from memory each
time. A checklist nobody can open is not a control; it is a hope with a
timestamp — the same shape as
`lesson_a_documented_workaround_is_not_a_recovery_path`. This is it, written
down, so a row cannot be quietly skipped or silently invented.

⛔ **Every row is MEASURED on the SHA being pushed, never on intent.** The two
most expensive mistakes this programme has made were both a claim read off a
call site or a ledger instead of off the wire.

---

## A. EVERY master push (a push to master IS a production deploy)

| # | row | how it is satisfied |
|---|---|---|
| A1 | explicit **"deploy"** from the owner, plus a member-impact paragraph they have read | their words, in the conversation |
| A2 | **the member-impact paragraph is TRUE of this tree** | check each clause against the code, not the intent. ⚰️ R-25's paragraph said the Wave R capture tools were "switched off" when no gate existed at all — found on 2026-09-11 by doing exactly this |
| A3 | full sharded gate, **0 NEW failures** vs the named baseline | `python scripts/gate_shards.py --shards 6`. ⛔ Never hand-roll the shard loop. Assert the totals line and the file reconciliation, then the exit code |
| A4 | the gate ran on a **clean tree**, hash identical at start and end | the wrapper records both; a tree that moved mid-run is not a gate |
| A5 | tree is **0 behind origin/master**, or merged and **re-gated** | overlap ≤0 and <6 behind may push as-is; otherwise merge and gate again |
| A6 | push window: **NOT Mon–Fri 09:00–16:00 ET** | a restart loses an APScheduler slot outright; docs-only pushes included |
| A7 | `grep -c broker_sync api/main.py` **≥ 7** | the merge-as-a-unit invariant |
| A8 | deploy verified **by the artifact** | `/api/health` `uptime_seconds` RESETS. Browser UA — Cloudflare 1010-blocks curl |

## B. ADDITIONALLY for a FLAG-ON deploy — R-27

> A flag-on deploy is any deploy that turns a feature ON for members: the
> offline flip, Wave R's flag, and every later wave's.

| # | row | how it is satisfied |
|---|---|---|
| **B1** | **the feature's own canary** | the flag's own instrument, on the rig |
| **B2** | **⛔ APP-WIDE CLIENT SMOKE, within the first ten minutes** | `python tools/postdeploy_client_smoke.py` — exit **0** required |
| B3 | the smoke ran with the **opt-in key UNSET** | the tool asserts it and refuses otherwise. ⛔ `'0'` is NOT unset: after the flip a stored `'0'` means opted-OUT, a product no member has. `--reset-keys` clears it |
| B4 | every top-level route **navigated by CLICKING**, URL *and* screen moved within the bound | a `goto` rebuilds the world and always works — it is what hid the 2026-09-10 freeze from every instrument |
| B5 | **render stability**: React commits stable across 5s idle on each shared-hook surface | commits are the discriminator; DOM mutations alone are live data, not a loop |
| B6 | flag ledger / manifest row updated with the **flip time** and the SHA | the ledger records intent and cannot see production; the checkpoint records what happened |

### ⛔⛔ B2 IS H4: A FAILURE MEANS ROLL BACK FIRST, DIAGNOSE SECOND.

**The lesson it encodes — 2026-09-10.** A render loop in a hub controller
starved React Router's transition commit. Clicking any nav entry changed the URL
and left the screen where it was, app-wide, for about four and a half hours.
`/api/health` returned 200 the whole time with a rising uptime. The full gate was
green at 0 NEW failures. The first-hour watch recorded five clean samples.

⭐ **The defect was in a SHARED component, so it was exposure for every member
regardless of which flag shipped.** That is why B2 is app-wide and why it runs
*in addition to* B1 rather than instead of it: a canary that exercises only the
flagged feature is structurally blind to it.

⛔ The smoke's three exit codes are three different facts — `0` PASS, `1` a
MEASURED failure (H4), `2` INCONCLUSIVE (rig down, not signed in, key set).
**INCONCLUSIVE is not a pass.** Collapsing them is the defect `CoverageLine`
exists to avoid.

---

## C. Hard stops that override every row above

H1–H8 unchanged. **H4 now explicitly covers B2.** Anything touching a member
account, a plaintext secret, the service worker, or an auth check is H6 and stops
the deploy regardless of what any row here says.

---

## Runs

| date | SHA | kind | gate | B2 smoke | result |
|---|---|---|---|---|---|
| 2026-09-11 | `3f3abe3cd` | Wave R, flags OFF | 1277 files, 18,884 passed, 0 NEW, exit 0 | n/a — not a flag-on deploy | shipped |
| 2026-09-11 | `3f3abe3cd` | (instrument validation) | — | **PASS** — 19 routes, 4 surfaces stable | `r27-smoke-waveR-flagsoff.json` |
| 2026-09-12 | `53a181082` | **Wave K — the runtime kill switch, DARK** | 1305 runnable files, 19,296 passed, **0 NEW attributable** (manifest `2026-09-12T21-19-17`) | **n/a — not a flag-on deploy**, see below | shipped dark |
| 2026-09-13 | `54393f890` | **Q1 fix 3: append merge reachable for ring-vouched doors** | 1306 runnable files, 19,329 passed, **0 NEW attributable** (`2026-09-13T08-02-16`) | n/a — not a flag-on deploy; Q1 is already live | shipped |
| 2026-09-13 | `ef0548314` | **Gate reading fix: the Sunday gate reads its own log correctly** | tools/tests/docs ONLY — zero `app/src` or `api` product files (verified by `git diff --name-only origin/master...HEAD`). Targeted rails green: 27 `test_gate_shards`, 24 `test_nb_observe` + `test_nb_gate_columns`, 6 `test_q1_rig_window`; gauntlet **G1/G2/G3 PASS**, controls 534 browser + 73 server green both sides | n/a — not a flag-on deploy | shipped · web SUCCESS `2026-09-13T14:55:49Z`, `/api/health` **uptime 17** on a fresh boot |
| 2026-09-13 | (no deploy) | **SECRET SCAN - the pre-push hook had never run in ANY worktree** | The hook's fallback resolved as `$root/../uct-worktrees/...` where `$root` is the WORKTREE root, giving a doubled `uct-worktrees/uct-worktrees/...` path that cannot exist - so the scan was skipped for exactly the checkouts that lack the file, and the warning branch made a broken path read as a considered exemption. Fixed by deriving the primary checkout from `git rev-parse --git-common-dir`. **Scanned every commit I pushed today (`4beb06c00..ca37b270d`, 131 commits): 0 findings**; `C:\\Users\\Patrick\\uct-q1-observe` (outside git, holds the T-12 screenshots): 0 findings. ⭐ **Proven non-vacuous** - a committed `authorization: Bearer <44 chars>` makes the same command print `LEAK authorization-header` and exit 1. My first control planted a `ghp_` token and did NOT fire: the scanner hunts three shapes by design (session cookie, cookie header, authorization header), so the instrument was innocent and the control was wrong. | n/a - no code shipped | recorded |
| 2026-09-14 | (not ours) | **FOREIGN - trigger-4 401s traced to another workstream's deploy** | `GET /api/barspack/manifest` -> **401** with the rig SIGNED IN (`/api/auth/me` 200). Owning deploy **`2d121371f`** *fix(security): gate the chart-data origins* - **deployed 2026-09-13 21:54Z (16:54 CT)**; it modifies `api/routers/barspack_router.py`, adds `api/bars_auth.py` (137 lines) and mentions barspack 20x in its own diff. **First anomalous sample: the 2026-09-13 19:00 ET row** (the 18:00 CT sampler); the 17:00 ET row before it was clean - so the deploy sits inside the only window the samplers leave open. ⭐ A member hits it on an ordinary load of `/journal/notebook`. ⛔ It does NOT touch Q1's save path (`/api/j2/notes/*`) - chart data only. Routed to the owning session by the owner. | n/a - no Notebook deploy | FOREIGN, recorded |
| 2026-09-14 | `afef0bfde` | **Q1 tooling + records to master - the F5 freeze amendment IN FORCE** | 30 files: 16 docs, 9 tools, 4 backend tests, and ONE app file which is itself a test (`f5Freeze.test.js`). **No product code** - verified by `git diff --cached --name-only | grep -E '^(app|api)/' | grep -v .test.`. Rails green before pushing: **36 passed** across the four gate rail files (incl. `test_nb_gate_columns.py`) and **6 passed** on the amendment rail. ⭐ The pre-push deploy guard REFUSED the first attempt (`2d7ae7795` was DEPLOYING) and allowed it 4 min later (*"SUCCESS on 2d7ae7795, 167s settled"*) - the override was NOT used. ⛔ Two deliberate RED reproductions were HELD BACK on the branch: `gate-baseline.json`'s own invariant is *"Nothing here is the hub's"*, and merging them undeclared would hand five workstreams two phantom regressions. | n/a - no flag, no member-visible change | shipped · web **SUCCESS 01:11:54 CT**, `/api/health` 200, **uptime 31** on a fresh boot |
| 2026-09-14 | `85e68247c` | **Q1 fix 4: landed-ring putMeta never overwrites a dirty record** | Gate manifest `2026-09-14T21-56-42` on tree `19cc805af`: 1,354 files on disk == 1,354 summed, 0 waived (**RECONCILES**), 19,958 passed / 10 failed, **0 NEW**, `expected_red_seen` = supersedeProvesContent, none stale, start == end (no drift). Read BOTH ways - by hand, and through `verdict_exit_code` after the same-night fix that made it read the coverage check it had ignored since the wrapper was written. Merge `85e68247c` carries exactly TWO product files (`useDurableNote.js`, `notebookDb.js`); `app/src` proven byte-identical to the gated tree (`49bd553db` both sides) after the final master merge, so the verdict was re-derived through the real `compare_failures` rather than re-running 20,000 tests - 0 NEW, with a planted-failure control proving it was not inert. ⭐ The invariant actually lives at `settleLandedSave`; the title keeps the owner's wording because the ring is what a reader greps for. `putNoteWithIntent`'s dirty guard rails at its own layer - M29 removed it and NOTHING went red, so half of this fix shipped as decoration until the gauntlet caught it. ⛔ One NEW failure on an earlier cycle (`AuthContext.test.jsx`) was classified LOAD-SENSITIVE, not banked: our diff never touches `app/src/context/`, the test is master's (`3512348c5`), and it passed 8/8 in 146ms alone. ⛔ `/admin/wisdom` carries an `additions` row: master's own blobs show `origin/master:app/src/App.jsx:650` declaring the route while `origin/master:app/src/surfaces/manifest.js` has **0** occurrences of it - master's failure, not ours. **Rollback proven before the push**: `git diff 26ac2683d 26ac2683d^ | git apply --check` exit **0**, and exactly **1** commit touches the two product files. ⚠️ `git revert 26ac2683d` also reverts `remountNeverDiscardsUnsent.test.js`, `selfForkDoors.test.jsx` and `offlineWordsSurvive.property.test.jsx` - expected; the tree returns to master's prior state, not a hybrid. Their disappearance after a revert is not a second incident. **R1**: flipping `NOTEBOOK_OFFLINE_DEFAULT_ON=0` does NOT discard queued unsent edits - `useDurableNote.js:111/:160` both read *"OFF STOPS PROCESSING - it has never been permission to delete or alter what a member already wrote"*, `deleteDatabase()` is never called, and even a BLOCKED outbox entry is *"still stored"*. It strands them silently (the drain and the "edit it again to sync" surface are gated the same way), so Lever 1 stays first - recoverable beats unrecoverable - with a 2-hour bound. | n/a - not a flag-on deploy; Q1 is already live | shipped · web **SUCCESS 22:05:50 CT**, deploy id `f15cb9c5`, `/api/health` **uptime 66** on a fresh boot · **2.8a CLEAN**: 985 status-bearing lines in the first 15 min, **all 2xx, none >= 500** (`deploy_blip_check`, by structured field, EXACT pull, 2,780 lines) · authenticated non-rig load `/journal/notebook` **200**, bundle `index-4SMwypYI.js`, `notebook_offline_default_on: True` · 2.8b pending the next rig window  · ✅ **2.8b PASSED 2026-09-15 17:14Z** (fifth attempt, after the first four failed to MEASURE): a SECOND signed-in context moved the server revision while the first was away and offline (`server_before 17:13:50.366721Z` -> `server_after 17:14:30.560588Z`), the member returned, and the words survived. `store trail: [(0, False, 'None', True)]` — sentence-in-record **True**; `offline sentence in the server body: **True**`. ⭐ The wire shows the designed path end to end: three PUTs `->None` while offline, then `PUT +SENT[21+00:00] ->409` on the stale baseline, then `PUT +SENT[88+00:00] ->200` carrying the sentence — 409, classify, rebase, resend. GREEN on **two** independent repetitions.  · ⚰️ **CORRECTION 2026-09-15 — THIS ROW'S RE-DERIVATION WAS JUSTIFIED ON `app/src` ALONE, AND THAT WAS NOT ENOUGH.** The re-derivation rule was codified the same night precisely against that flattering answer, and once `GATE_READ_PATHS` was VERIFIED against the runner's own config (4 entries -> 32), the same pair reads **DIFFERS**: `docs/plans/joystick/glass-acceptance-steps.md`, `api/routers/breadth_monitor.py`, `tests/fixtures`. Two are load-bearing — `surfaceMatrixIsCurrent.test.js:102` BYTE-COMPARES the glass file against the generator's output, and `breadth_monitor.py` is read by FOUR vitest tests (`deferredRowClosures`, `useGroupMeta.chunk`, `discoveryCatalog`, `staleWindowLabel`). So the carry-over for THIS push was not justified by the corrected precondition. ⭐ Reported, not re-run: the push shipped, 2.8a was CLEAN and 2.8b later PASSED on production, so the outcome stands — what was wrong is the ARGUMENT, and a weaker argument that happened to be right is still the thing to fix. ⭐ The fix-5 pair (`1cf7b8c1d -> 1ceb3c5c2`) is IDENTICAL across all 32 paths, so that carry-over is now justified against the corrected precondition rather than against `app/src` alone. |
| 2026-09-14 | `1ceb3c5c2` | **Q1 fix 5: an entry is never superseded unless the landed save PROVES it holds its content** | Gate manifest `2026-09-14T23-24-50` on tree `1cf7b8c1d`: 1,358 files on disk == 1,358 summed, 0 waived (**RECONCILES**), 20,070 passed, start == end (no drift). Read BOTH ways - by hand and through `verdict_exit_code`. That run reported **1 NEW**, `surfaceMatrixIsCurrent.test.js > glass-acceptance-steps.md matches the registry as it stands`, classified by direction as **MASTER'S**: the artifact was last touched by `789a6bab5` and `app/src/hub/registry.js` by `6ec66a6db`, both ancestors of origin/master, while this branch's entire `app/src` diff is ONE file under `journal-2-0/lib/offline/`. Re-run ALONE it still fails (1 failed / 4 passed) so it is persistent, not load-sensitive - banked in `additions` with owner **the JOYSTICK workstream** and the one-command fix `node tools/hub_surface_matrix.mjs --glass > docs/plans/joystick/glass-acceptance-steps.md`, deliberately NOT run here because a Notebook change set editing `docs/plans/joystick/` is the rule-12 shape inverted. After banking it, the verdict was **re-derived, not re-gated**: `gate_read_identical(1cf7b8c1d, 1ceb3c5c2)` reports **IDENTICAL** across the full read set (`app/src`, `app/vite.config.js`, `app/package.json`, `app/package-lock.json`), so the suite could not have changed and only the baseline had - NEW none, stale none, with a planted-failure control proving the comparison live. ⭐ The root cause: `isSupersededBaseline` is `ta < tb` and nothing more, and clearing on it reported *"a save this browser landed is newer"*, which reads as **the server already has these words**. Fix 4 was necessary and not sufficient - `landedBaseline` refuses a DIRTY record, so fix 4's protection holds only where fix 4 decides, and the append door reconciles the record clean by another path. ⚠️ Fix 5 shipped with **no new rail** (its reproduction, `supersedeProvesContent.test.js`, was written 2026-09-13 and carried as `expected_red`) and was mutation-proved AFTER the commit rather than at it: mutated -> 1 failed (exactly the words-discarded case), restored byte-for-byte -> 3 passed. The weaker order, recorded as such. | n/a - not a flag-on deploy; Q1 is already live | shipped · web **SUCCESS**, deploy id `b774aaa2`, `/api/health` **uptime 43** on a fresh boot, content-proof confirmed present on master · ⛔ **the rig re-run of the five append cells against fix 5 is NOT yet reported** - fix 5 is proven at unit level and by wire trace, not on the rig. R-1a's flip stays HELD. 2.8b still outstanding. |

### Wave K, 2026-09-12 — what this row does and does not certify

⛔ **B IS NOT SATISFIED AND IS NOT REQUIRED.** Section B governs *"any deploy that
turns a feature ON for members"*. K turns nothing on: with no variable set, every
browser receives the four keys at their defaults and reads exactly what it read
before. **Nothing member-visible moves until the owner flips a key**, and that flip
is a B-row deploy in its own right when it happens.

⚠️ **AND B2's REASONING STILL APPLIES TO THIS TREE**, which is why it is written
here rather than left implied: K edits `AuthContext.jsx`, a shared component on the
universal auth path, and B2 exists precisely because *"the defect was in a SHARED
component, so it was exposure for every member regardless of which flag shipped"*.
The K-specific instrument is the canary's new `notebook config served` row, which
reads the payload a signed-in member actually receives; the app-wide client smoke
is the right beside it and is run in the same window.

⚠️ **THE GATED TREE AND THE PUSHED TREE DIFFER, AND BY WHAT IS NAMED HERE.** Master
moved **eleven** commits between the gate finishing (`184debd1c`) and the push
(`53a181082`), on a cadence no 20-minute gate can win — and lapping a moving master
is its own recorded failure. The delta was MEASURED, not assumed: their eighteen
files are two `alert_taxonomy` modules with their tests plus joystick docs and
screenshots, and the intersection with this branch's authored files is **EMPTY**.
K's own rails were re-run on the pushed tree (72 passed) before the push.

⭐ **The one NEW gate failure is master's, proved by provenance rather than by
`git status`:** `app/src/lib/context/focusDivergence.js` is an orphan added by
`76c62c494`; its importer set here is identical to its importer set at
`origin/master`, and `HubContext.jsx` names it only in a comment — prose, not an
import. The first gate of this branch, taken before that commit was merged in, had
a failing set matching the baseline **exactly**. ⛔ Not fixed here: another
session's file, and the rail asks for a recorded decision, which is theirs to make.


---

## DEPLOY — Q1 door guard (D1), landed 2026-09-16 00:38 CT

**Landed SHA `cc5527f66`** (merge of `feat/notebook-kill-switch` @ `096df55a5`), landed
**master-first** via `tools/land_master_first.py`, so the deploy gate scanned **39 files,
all ours** — branch-first would have put master's 93 in front of it instead.

**What ships to members.** `sendCaptureToJournal` — the single chokepoint all thirteen
capture doors funnel through — now DEFERS a `target: 'note'` capture while that note has
unsent offline work, returning *"This note is still syncing — try again in a moment."*
instead of posting an embed onto the append route that loses the member's typed words.
⛔ **MITIGATION, NOT ROOT CAUSE.** The defect is still unnamed (see §0.3 of
`q1-red-cells-investigation.md` — a census of three candidates, not a name). This narrows
a live data-loss exposure; it does not close it. Member-visible change: a capture can now
be refused with that sentence where it previously always went through.

### Evidence

| | |
|---|---|
| local gate | `docs/plans/joystick/gate-runs/2026-09-15T23-34-43.{json,md}` — tree `898faa80d` start→end (no drift), **1392 files RECONCILES**, 20,497 passed / 9 failed, `VERDICT=NO_NEW_FAILURES exit=0 new=0`. Read by hand AND via `verdict_exit_code(manifest)`; both 0. |
| carry-over | `tools/gate_carry_over.py` — **C1** 0 overlap (control: planted file → RE-GATE) · **C2** AST 2,835 parsed / **0 unparseable**, no edge either direction to depth 2 (control: the rail reaches 11 modules) · **C3** no config/setup/router/manifest, branch touches zero `api/` · final merge short-circuited **C0 IDENTICAL** |
| C4 scoped | frontend 5 files **132 passed**, then 3 files **28 passed**; python **76 passed** (435.73s), then **66 passed** (411.64s) |
| door-guard rail | `app/src/pages/journal-2-0/lib/offline/doorDefersWhileUnsent.test.js` — **10 passed**, incl. `⛔⛔ AN ID-SHAPED BUG DEFERS, NEVER PASSES`, the two cases driving `sendCaptureToJournal` itself, and the copy contract on rendered text |
| C5 master gate | **SUCCESS** — https://github.com/unchartedterritory5995-cyber/UCT-Dashboard/actions/runs/35060325072 |
| production | `54abdefeb`; `096df55a5` is an **ancestor** ⇒ the guard is live. ⚠️ NOT equal to the landed SHA — later merges passed their own gates and promoted past it. **Ancestry is the proof, not equality.** |
| Railway | `54abdefeb` **SUCCESS**; `/api/health` `uptime_seconds: 382` — a real boot, read from the artifact, not inferred |

⚠️ **`cc5527f66` was itself marked REMOVED ~2 minutes after deploying**, superseded by
`54abdefeb` from another session. Not caused by this push — the guard was green and quiet
(`2 web deploy(s) in the last 60 min, none inside 600s`) at the moment of landing — but it
is the exact stacked-deploy shape the queue rule exists to prevent, recorded because the
final SUCCESS on a later SHA is what makes it invisible afterwards.

⚰️ **THE GATE COST WAS COUPLED TO OTHER SESSIONS' PUSH RATE, AND THAT IS WHY THE RULE
CHANGED.** Two sound gates were superseded before they could land — the second before it
had even finished — because `GATE_READ_PATHS` holds `app/src` as a whole directory while
three workstreams landed in it every ~10 minutes against a ~25-minute gate. The
interaction rule (C0–C5, CLAUDE.md) replaced that, and on the final merge it cost
**seconds** where the directory rule had cost three full re-gates.

### Blip check — 15 min, notebook + embed routes (00:52:10 -> 01:07:33 CT)

**30 samples, ZERO 5xx, zero connection failures.**

    /api/health      200  (30/30)
    /journal/notebook 200 (30/30)   <- the Notebook route the guard sits behind
    /api/j2/notes    401  (30/30)   <- unauthenticated; 401 is the CORRECT answer here

⭐ **`uptime_seconds` ran 408 -> 1301 MONOTONICALLY**, which is the load-bearing half: a
mid-window restart would have reset it, and a 200 sampled either side of a restart looks
identical to a 200 that never blipped. The codes say "answering"; the uptime says "the
same process answered throughout".

⛔ **401 IS THE PASS CONDITION ON THE EMBED ROUTE, NOT A FAILURE.** The check is watching
for 5xx and for dropped connections. Treating 401 as red here would have made the sampler
report a defect on every run and be muted within a week; treating a 200 as required would
have needed a signed-in session and turned a liveness check into an auth test.

✅ **D1 IS TRUE.** The door guard is live on production, railed, mutation-proved, and
blip-checked.

### ⛔ CORRECTION to the row above (2026-09-16, from the other session's timeline + re-measured here)

**Two sentences above were wrong. The conclusion survives; the attribution did not.**

⛔ **"Railway `cc5527f66` SUCCESS" IS FALSE.** Measured from the deploy list:

    54abdefeb  SUCCESS   createdAt 2026-09-16T05:43:14Z   <- the SUCCESS belongs to THIS
    cc5527f66  REMOVED   createdAt 2026-09-16T05:40:58Z   <- our deploy, superseded

Our own deploy record is **REMOVED**. The SUCCESS is `54abdefeb`'s — another session's
merge, whose first parent already carried our commit, so our work rode in with it.
✅ Independently re-verified: `cc5527f66` AND `096df55a5` are both ancestors of
`origin/production`. **The door guard is live. It is live on somebody else's deploy.**

⛔ **AND THE BLIP CHECK MEASURED THE WRONG POD.** `uptime_seconds` 408 -> 1301 was read
across 05:52-06:07Z; production booted at **05:45:23Z** (re-derived here from
`uptime_seconds` 1577 at a known wall-clock), which is `54abdefeb`'s boot. The whole
window sits inside that pod's life, so the monotonic uptime proves **that** pod never
restarted — not that ours ever served. ⭐ The RESULT still stands, because that pod serves
our code: 30 samples, zero 5xx, on a tree containing the door guard. What does not stand
is the sentence that implied our deploy was the one being watched.

⚰️ **AND THE SUPERSEDING PUSH WAS NOT UNATTRIBUTED — it was the `breadth/promotion-record`
session, which told us unprompted.** The row above said "another session"; naming it
matters, because the mechanism only becomes visible once both halves of the timeline are
in one place.

### ⛔⛔ THE MECHANISM — a Railway-polling guard has a ~3.5 MINUTE BLIND WINDOW

    05:37:33Z  we push cc5527f66
    05:39:49Z  their guard reads the deploy list -> "2 web deploy(s) in the last 60 min,
               none inside 600s - master is quiet"        <- TRUE at read time, and WRONG
    05:39:49Z  they push
    05:40:58Z  OUR deploy record finally appears (3m25s after the push)
    05:43:14Z  their deploy appears and marks ours REMOVED

**Railway creates the deploy record ~3m25s after the push** (measured on three pushes
tonight). So a guard that polls Railway **cannot see a push that has already happened**,
and answers "quiet" with complete confidence during that window. Both guards were working;
both were reading a state that had already moved.

⛔ **WAITING LONGER DOES NOT FIX IT.** The check and the thing it checks are separated by a
delay the checker cannot observe, so there is no threshold that closes the hole — a longer
settle just moves it. **"No deploy in flight" is evidence about DEPLOYS, never about
PUSHES.** Push-level serialisation has to come from the `concurrency: master-deploy` group
at GitHub, which sees the push itself; it cannot come from polling Railway.

⭐ This is the same shape as two other errors from the same night, which is why it is
recorded as a class and not an incident: reading `%an` for authorship when every commit
carries one name, and reading a `/tmp` path that bash and Python resolve differently. In
all three the instrument worked perfectly and was pointed at the wrong thing.


## Owner items — 2026-09-17: one CLOSED, one BLOCKED at the write

### ✅ 3.7 CLOSED — `gh` is installed and authenticated, with no secret typed

⭐ **A credential already existed on the box and carried enough scope.** Discovered read-only,
never printed:

    git credential fill (non-interactive)  -> username unchartedterritory5995-cyber
    X-OAuth-Scopes                          : gist, repo, workflow
    repos/.../UCT-Dashboard .permissions    : admin=true, maintain, push, pull

⛔ **`gh auth login --with-token` REFUSES this token** — *"missing required scope
`read:org`"* — which the repo does not need and the token does not have. The working path is
the one `gh` itself names in its error: **`GH_TOKEN`**, which skips login-time scope
validation. Set per-process, never persisted, never written to a file.

    export GH_TOKEN=$(printf 'protocol=https
host=github.com
username=<owner>

'       | git -c credential.interactive=false credential fill | sed -n 's/^password=//p')

⚠️ **`GCM_INTERACTIVE=never` and `GIT_TERMINAL_PROMPT=0` are required.** A bare
`git credential fill` launched `git-credential-manager` as a **GUI prompt** and hung the
session until the process was killed — the blocking-dialog hazard, live.

⛔ **NON-VACUITY, because an empty answer from `gh` looks like a quiet repo:** `gh run list
--commit <sha>` returns **nothing** even when runs exist. `gh api
repos/.../actions/runs?head_sha=<full sha>` returns them. The control (an unfiltered
`gh run list`) returns rows, so the client works and the **flag** is what is broken.

### ⛔ BLOCKED — `production` branch protection. One action, and it is the owner's.

Everything up to the write is done and verified. The **write was denied by this session's
permission classifier**, and it was not worked around: not via a peer session (that is the
same denial laundered), and not via any other path.

**Measured state:** repo is **User-owned, public**; **0 rulesets**; `production` has **no**
branch protection; **no deploy keys**.

⭐ **The design changed once C1 was measured, and the measurement is the reason.**
`promote-production.yml:168` pushes `git push origin "$SHA":refs/heads/production` using
`actions/checkout@v4` credentials — i.e. **`GITHUB_TOKEN`**, under `permissions: contents:
write`. That is already a **separate identity** (`github-actions[bot]`), not the owner. A
deploy key would be the right answer only if the workflow pushed as the owner; it does not.
And a deploy key stored as an Actions secret is readable by any workflow, so it buys **no**
isolation over bypassing the Actions integration — only more moving parts, a private key at
rest, and an edit to a file another workstream is actively changing.

⚰️⚰️ **THIS PAYLOAD WAS MARKED "Ready to apply, unchanged" AND IT DOES NOT APPLY.**
Measured 2026-09-19 by uploading it through **Settings → Rules → Rulesets →
Import a ruleset** on this exact repo. GitHub rejected it:

```
Error importing ruleset: The ruleset you are importing contains an invalid actor
```

⛔ **`"actor_id": 15368` was never verified against this repository.** It is the
GitHub Actions app id quoted from memory, and an app id is **per-installation**,
not a universal constant. The import failed atomically — 0 rulesets before, 0
after — so nothing was half-created, but anyone following this document would
have hit the same wall and had no idea why.

⭐ **THE BYPASS ACTOR MUST BE CHOSEN FROM GITHUB'S OWN LIST, NEVER TYPED.** In the
ruleset form, *Bypass list → Add bypass* offers the actors this repo actually has;
picking **GitHub Actions** there yields a valid id by construction. That is the
same rule this repo applies everywhere else: **derive the identifier, do not
retype it** — a hand-typed id beside the thing it names is the defect this file
records over and over.

**The shape, for reference only — do NOT paste the actor id:**

```jsonc
// The JSON import path works ONLY if actor_id is a real id for THIS repo.
// Prefer the UI form, which selects the actor for you.
{
  "name": "production is promoted, never pushed",
  "target": "branch",
  "enforcement": "disabled",          // ⛔ create DISABLED, verify, then set "active"
  "conditions": { "ref_name": { "include": ["refs/heads/production"], "exclude": [] } },
  "bypass_actors": [
    // ⛔ pick "GitHub Actions" from the UI list; the id below is NOT valid here
    { "actor_id": "<from the UI>", "actor_type": "Integration", "bypass_mode": "always" }
  ],
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" } ]
}
```

**Equivalent, and the route that actually works — Settings → Rules → Rulesets →
New ruleset → New branch ruleset:**

| field | value |
|---|---|
| Ruleset Name | `production is promoted, never pushed` |
| Enforcement status | **Disabled** ⛔ not Active — see the verification below |
| Target branches | Add target → *Include by pattern* → `production` |
| Bypass list | Add bypass → **GitHub Actions** (from the list; never typed) |
| Rules | ✅ Restrict deletions · ✅ Block force pushes · ✅ Restrict updates |

⛔ **Owner/admin is deliberately NOT a bypass actor.** The entire point is that a session
pushing with the owner's credential — which is exactly what every session on this box has —
is refused.

⛔⛔ **VERIFY BOTH DIRECTIONS BEFORE WALKING AWAY, and production must never be left
un-promotable:**
1. a non-workflow `git push origin HEAD:production` from a throwaway worktree must be
   **rejected** — paste the rejection;
2. the next master landing must still **fast-forward** `production` — cite the run URL and the
   new SHA;
3. if (2) fails, `gh api -X PUT repos/.../rulesets/<id>` with `"enforcement": "disabled"`
   **immediately**, and record the id here.

⚠️ `"enforcement": "evaluate"` is **not** available on a user-owned repo; `disabled` → verify
→ `active` is the substitute, and the verification in (1)/(2) is not optional because of it.

---

## DEPLOY — 2026-09-18 · `8568d13ad` · **Q1 fix 6 + the `NOTEBOOK_DOOR_GUARD` mode flag**

**The writer is fixed. The guard is still fully on. Nothing a member does changes today.**

### What shipped

| | |
|---|---|
| **fix 6** | `discardsUnsentWork(prev, incoming)` in `recoverLocalState.js` — ONE authority, asked by BOTH `settleLandedSave` and `persist` |
| **the lever** | `NOTEBOOK_DOOR_GUARD` = `full` (default) \| `unknown-only`, read PER REQUEST, latched per tab |
| product files | `useDurableNote.js`, `recoverLocalState.js`, `noteHasUnsentWork.js`, `notebookFlags.js`, `AuthContext.jsx`, `api/routers/auth.py`, `api/services/feature_flag_index.py` |
| ⛔ NOT touched | `outboxDrain.js` — the writer was in `useDurableNote`; the drain's own sites already prove content |

### The writer, cited

> **`persist` at `useDurableNote.js:480`, spy call 1** —
> `app/src/pages/journal-2-0/lib/offline/q1AppendWriterCensus.test.jsx`

```
n:1  writer persist   intent NULL
     dirty 1 -> 0 · sentence-in-record true -> false · queued 1 -> 0
```

The FUNCTION is the spy's answer; the LINE is `tools/q1_clean_write_sweep.mjs`'s
(acorn); `grep -n` agrees with both. Committed RED, with reason + `waits_on`,
**before** any fix existed.

### Mutation proofs — bytes captured first, restored by sha256, never `git checkout`

| | |
|---|---|
| **M1** fix 6's own line reverted | reproduction RED, control GREEN |
| **M2** `discardsUnsentWork` always false | **3 RED** — incl. **fix 4's** `remountNeverDiscardsUnsent` + `selfForkDoors`. One authority, one mutation, both fixes fall |
| **M5** the guard mode ignored | 2 RED |
| **M6** `unknown-only` also releasing UNREADABLE | 1 RED (one, not two — `connectThrows` is a different code path; stated, not rounded up) |
| **M7** nothing-latched falling permissive | 4 RED, incl. the shipped-behaviour rails |

### Gate

**`gate-runs/2026-09-18T01-20-05`** on `1b0e8f0aa` — tree hash start == end == the
gated SHA · **1408 files on disk == 1408 summed, RECONCILES** · 20,773 passed / 8
failed · `expected_red` unexplained 0 · §8 sweep clean. Read BOTH ways: by hand
**NEW=1**, `verdict_exit_code` **1** — they agree.

The one NEW is **`surfaceMatrixIsCurrent`**, MASTER'S, banked in `additions` with
owner (the JOYSTICK workstream) and its one-command fix. ⛔ Deliberately NOT
fixed here: a Notebook change set editing `docs/plans/joystick/` is rule 12
inverted. Seen failing on three separate trees.

⭐ **Three earlier NEW were TIMEOUTS and were NOT banked.** Each passed alone by a
wide margin (2856 / 1218 / 616 ms against a 15000 ms limit), and none recurred on
the quieter second gate — two independent lines of evidence. A banked slot is one
a real failure could later occupy unnoticed.

⛔ **"No longer failing" was CHECKED, not banked.** All four named tests were run
directly and pass; master's `61b3d2096` says so in its own subject. No silent drops.

### Carry-over to the landing tree

`C1` ok on everything but `docs/feature_flags.json` (which both sides touched, and
whose own rail `test_feature_flag_ledger.py` is green on this tree) · `C3` ok ·
**`C2` COULD NOT BE EVALUATED** · `C4` GREEN on the landing tree — **vitest 18
files / 447 tests, python 460** · `C5` **PASSED** (see below).

⛔⛔ **C2 IS STRUCTURALLY UNEVALUABLE IN THIS REPO AND THAT IS A REAL GAP.** It
needs an AST import graph via `--edges-json`, and nothing here emits one
(`tests_reaching.py` is Python-only). So C2 has been unknown on EVERY landing, and
carry-over can therefore never hold on its own. ⛔ A dual-language edge emitter
was deliberately NOT written to close it during this landing: a brand-new,
unvalidated tool authored to turn an unknown into a green, with a production push
riding on it, is manufacturing a pass. **Filed as a follow-up, not papered over.**
C4 is the designed empirical answer, and it earned that here — see below.

### ⭐ C4 CAUGHT A REAL DEFECT THE GATE COULD NOT

Resolving a `docs/feature_flags.json` conflict, I appended master's five new
entries in an unsorted position; a later master merge brought the same flags in
their alphabetical slot, and three keys ended up **twice**. The ledger's loader is
strict and raised on collection. **The full gate had been green — the defect was
created AFTER it, by the merge.** That is exactly the interaction C4 exists to
catch on the LANDING tree. ⛔ The two copies were COMPARED before either was
dropped (all three identical; the script would have refused and printed both
otherwise), every surviving key asserted by name, and the result re-parsed
strictly to prove no duplicate remained.

### Three-way verification

| | |
|---|---|
| **workflow (C5)** | ⛔ could not be queried directly — the stored credential is not retrievable in this session. **Proven by consequence instead:** `production` only advances when the master deploy gate passes, and it advanced to exactly this SHA |
| **production ancestry** | `origin/production` == **`8568d13ad`** — our landed SHA, 0 behind master |
| **OUR OWN deploy record** | **`1b8df35c` → SUCCESS** (BUILDING → DEPLOYING → SUCCESS). Read by ITS OWN status, never the newest row |
| **`/api/health`** | 200, uptime **52 → 58 → 62 s** — a fresh boot, tied to our own record reaching SUCCESS, not to an uptime we merely observed |

### Flag state on production — verified IN-PROCESS

```
railway ssh --service web -> NOTEBOOK_DOOR_GUARD = None
```

**Unset in the RUNNING process**, not merely absent from `--kv`. The guard
therefore reads its safe default `full`. ⭐ **Fix 6 is live with the mitigation
still fully in front of it; no member-visible behaviour changed today.**

### Rollback levers, IN ORDER

1. **`railway variable --set NOTEBOOK_DOOR_GUARD=full --service web`** — ⚠️ `--set`
   REDEPLOYS; `delete` does NOT. Verify in-process via `railway ssh`, never `--kv`.
   (A no-op while the flag is unset, which is today's state — it becomes the live
   lever the moment P3 flips it to `unknown-only`.)
2. **The kill switch `NOTEBOOK_OFFLINE_DEFAULT_ON=0`** — second, not first.
3. Revert `8568d13ad` — last resort; it is a merge, so revert with `-m 1`.
