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
| 2026-09-14 | `85e68247c` | **Q1 fix 4: landed-ring putMeta never overwrites a dirty record** | Gate manifest `2026-09-14T21-56-42` on tree `19cc805af`: 1,354 files on disk == 1,354 summed, 0 waived (**RECONCILES**), 19,958 passed / 10 failed, **0 NEW**, `expected_red_seen` = supersedeProvesContent, none stale, start == end (no drift). Read BOTH ways - by hand, and through `verdict_exit_code` after the same-night fix that made it read the coverage check it had ignored since the wrapper was written. Merge `85e68247c` carries exactly TWO product files (`useDurableNote.js`, `notebookDb.js`); `app/src` proven byte-identical to the gated tree (`49bd553db` both sides) after the final master merge, so the verdict was re-derived through the real `compare_failures` rather than re-running 20,000 tests - 0 NEW, with a planted-failure control proving it was not inert. ⭐ The invariant actually lives at `settleLandedSave`; the title keeps the owner's wording because the ring is what a reader greps for. `putNoteWithIntent`'s dirty guard rails at its own layer - M29 removed it and NOTHING went red, so half of this fix shipped as decoration until the gauntlet caught it. ⛔ One NEW failure on an earlier cycle (`AuthContext.test.jsx`) was classified LOAD-SENSITIVE, not banked: our diff never touches `app/src/context/`, the test is master's (`3512348c5`), and it passed 8/8 in 146ms alone. ⛔ `/admin/wisdom` carries an `additions` row: master's own blobs show `origin/master:app/src/App.jsx:650` declaring the route while `origin/master:app/src/surfaces/manifest.js` has **0** occurrences of it - master's failure, not ours. **Rollback proven before the push**: `git diff 26ac2683d 26ac2683d^ | git apply --check` exit **0**, and exactly **1** commit touches the two product files. ⚠️ `git revert 26ac2683d` also reverts `remountNeverDiscardsUnsent.test.js`, `selfForkDoors.test.jsx` and `offlineWordsSurvive.property.test.jsx` - expected; the tree returns to master's prior state, not a hybrid. Their disappearance after a revert is not a second incident. **R1**: flipping `NOTEBOOK_OFFLINE_DEFAULT_ON=0` does NOT discard queued unsent edits - `useDurableNote.js:111/:160` both read *"OFF STOPS PROCESSING - it has never been permission to delete or alter what a member already wrote"*, `deleteDatabase()` is never called, and even a BLOCKED outbox entry is *"still stored"*. It strands them silently (the drain and the "edit it again to sync" surface are gated the same way), so Lever 1 stays first - recoverable beats unrecoverable - with a 2-hour bound. | n/a - not a flag-on deploy; Q1 is already live | shipped · web **SUCCESS 22:05:50 CT**, deploy id `f15cb9c5`, `/api/health` **uptime 66** on a fresh boot · **2.8a CLEAN**: 985 status-bearing lines in the first 15 min, **all 2xx, none >= 500** (`deploy_blip_check`, by structured field, EXACT pull, 2,780 lines) · authenticated non-rig load `/journal/notebook` **200**, bundle `index-4SMwypYI.js`, `notebook_offline_default_on: True` · 2.8b pending the next rig window |
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
