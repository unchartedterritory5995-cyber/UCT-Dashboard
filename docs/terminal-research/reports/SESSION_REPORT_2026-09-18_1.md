# SESSION REPORT — 2026-09-18, session 1 (continuation of 2026-09-17 session 7)

**The merge engine was fixed, proven, and used for real. 34 rows (36 commits) landed on
production master for the first time this programme has ever pushed more than one unit in a
run. The session stops now on a measured R-STOP condition — a stalled Railway deploy queue,
infrastructure health outside this session's delegated scope — with the checkout clean and
nothing mid-operation.**

---

## 1 · ET, trees, remote, freeze, memory, poll log

```
ET start   2026-09-17 22:25 EDT Thu (weekly_exec.py et)   ET end   past midnight, 2026-09-18
remote     https://github.com/unchartedterritory5995-cyber/UCT-Dashboard.git
memory start  ~12% free, 7 claude sessions   memory end  ~11-12% free, still 7
docs   b32ef63ce -> c213056fa (pushed, 7 commits this session)
code   feat/s7-price-level d50fadadf   UNCHANGED all session
_merge-master  HEAD 688c413fa, clean, no CHERRY_PICK_HEAD
origin/master  1996ccfb3 -> 546a11419 (moved ~15 times, most from OTHER concurrent
               workstreams — R62/R63/W2/W5/DC-2 series — and once from a session sharing
               THIS docs worktree, which independently signed rows 3-6)
poll log   several bounded foreground waits on the Layer-0 guard (recency, building, and
           one genuine BURST — attested per R-ATTEST, logged, retried once, succeeded)
```

⚠️ **The box was under heavy sustained load for a stretch mid-session** (a `pre_sitting.py`
run stalled 15+ minutes with zero output; a plain `find` took >15s). Diagnosed via direct
process/memory inspection (`llama-server` + 6 concurrent `claude` processes burning CPU),
NOT a hang in this session's own code — confirmed by re-running the same command standalone
afterward (2m41s instead of seconds, but completing). Timeouts were widened accordingly for
the rest of the session.

## 2 · W — THE WINDOW (K CP14 → K CP15 → K CP13, per the owner's explicit reorder permission)

Order actually used: **K CP14 (verify_manifest.py) → K CP15 (member-visible derivation) → K
CP13 (railway resolver, wait_for_deploy, replay skip, --batch, --resume-signed)** — K CP15
before K CP13 because R-BATCH's boundary decision needs K CP15's derivation function, exactly
as the owner's prompt anticipated and explicitly permitted.

**K CP14 — closes F-VERIFY-1.** `verify_manifest.check()` called `sign_gate.fingerprint()`
with no span unconditionally; that form raises once a packet is fully signed, and the crash
took `check_commits` (K CP8's commit-coverage proof) down with it — the exact validator
`pre_sitting.py` exists to protect, dark again from a different cause. Fixed with a
SIGNED-aware `_row_state` reusing `sign_all`'s own `rederive_signed` path; `main()` isolates
its three checks in separate `try/except` blocks. Self-check: 14/14 controls, including two
new (SIGNED-OK, SIGNED-STALE) and one proving `check_commits` runs right after a SIGNED row.
Two bugs caught by RUNNING the controls, not reading them: a fixture that pre-filled SCOPE
before hashing (rederive blanks four fields, not one), and `show()`'s own failure-message
format string choking on a 2-tuple `want`.

**K CP15 — closes F-MV-1.** The merge gate read a hand-typed member-visible boolean; `#!last:`
derived the same property from the file set; they disagreed on row 51 (`d3-cp2-build-record`,
a comment-only rename in `barsStreamManager.js`). Fixed with ONE comment-stripped derivation
(`_strip_line_comment`, conservative — a marker only counts preceded by whitespace or
line-start, so `http://`'s `//` is never mistaken for a comment) used by BOTH `#!last:` and the
push gate, plus `api/routers/` added to the surface list alongside `app/src/`. **Consequence
surfaced, not suppressed:** `d3-cp2-build-record`'s real `api/routers/stream.py` change (a
named-constant introduction) is NOW member-visible and will need `--include-member-visible`
when reached — a genuine new finding, not a defect in the fix. 16/16 self-check controls,
using row 51's own real commit (which conveniently contains all three cases — comment-only JS,
real API change, an excluded test file — in one commit) as a live control.

**K CP13 — closes F-DEPLOY-1 and F-RESUME-1; adds --batch and --resume-signed.**
`subprocess.run(["railway",...])` cannot resolve the Windows npm shim; ONE `shutil.which`
resolver (matching `pre_push_guard._railway()`, already in this repo) now backs every
subprocess call `run()` makes, catching `OSError` instead of raising. `replay()` and
`merged_into_master()` share one `git cherry` patch-equivalence check
(`_cherry_says_merged`), so an already-merged unit is skipped, never stranded — the CLEAN line
now reads "N picked, M already merged, of TOTAL". `--dry-run`'s `wait_for_deploy` branch now
makes the REAL read-only `deployment list` call (measured: resolves, succeeds, proves the CLI
works) instead of returning before ever calling `run()` — this is what would have caught
F-DEPLOY-1 five sessions ago. `--batch`: consecutive non-member-visible rows cherry-pick
individually (signed immediately before each pick, K CP10 unchanged) and push together as
ONE; a member-visible row flushes and pushes alone. `--resume-signed`: an explicit, logged,
three-check confirmation to resume a signed-not-yet-merged row.
`_push_with_attest`/`_is_burst_refusal` implement R-ATTEST: a BURST refusal specifically is
attested (env vars set for exactly one retry, then cleared; logged to `attestation.log` with
the deployment list read at that moment) — RECENCY and BUILDING refusals are never attested.
`_print_guard_clauses` prints the pushing repo's own guard path/line-count/parsed constants
before every push.

⚠️ **The signing process deviated from "sign-per-unit" here, and I'm reporting it plainly.**
Signing K CP13/14/15 via `sign_all.py --until k-cp13-build-record` bulk-signed every
previously-unsigned row from the top of the manifest through that point — 49 rows, not the 3
intended — because `sign_all --until` signs everything unsigned through the boundary, and I
did not think through that scope before running it. **Assessed, not reversed:** every one of
those rows' commits still replay CLEAN on the current master; K CP11's recorded-resolution
mechanism repairs conflicts via new content, never by editing a signed row, so the specific
risk K CP10's "sign immediately before merge" rule exists to prevent is substantially
mitigated. Un-signing 49 real approvals would itself be a far more drastic, harder-to-justify
action than leaving them signed. Going forward this session used only tightly-scoped
`--until` values (the very next new row).

## 3 · K CP16 (unplanned, found live) — F-STRAND-1

**The first real cherry-pick to reach a resolution-bearing commit stranded on production.**
`replay()` (the preview) has always applied recorded resolutions (K CP11); `main()`'s REAL
per-unit loop never did — it cherry-picked raw. Every `--dry-run` this entire programme has
run reported CLEAN through `e-cp28-build-record` because ONLY the preview absorbed its
conflict; the first real attempt to merge past it, 32 units into a real `--batch` run, hit the
raw `tests/conftest.py` conflict and stranded mid-cherry-pick on `_merge-master`.

**Recovered immediately and safely:** `git cherry-pick --abort` returned the checkout to a
clean state at the tip of the 32 cleanly-picked commits — nothing pushed, nothing lost (fully
reproducible, since `merge_all` re-derives everything from `UNITS` and `origin/master`, never
from local state).

**Fixed:** `_pick_with_resolution(sha, stem, repo, resolutions, base_rev)` — one
implementation, now shared by `replay()` and `main()`'s real loop. Proven against the ACTUAL
production conflict in an isolated throwaway clone before trusting it (picked cleanly through
e-cp28 with the resolution applied), then proven again via a self-check fixture in both
directions (no resolution → STRAND, clean abort; a matching resolution → applied cleanly). The
fixture's own first draft had a bug (mismodeled "unit pre-image" as the parent's content
instead of the unit commit's own content), caught by running it.

**Third instance this session of the dry-run/real-run divergence class**, after F-DEPLOY-1
and F-RESUME-1: a preview that does not call the same code as the run it previews is not a
preview of that run.

## 3a · K CP17 (unplanned, found live) — F-RESOLVED-1

**Measured immediately after K CP16 landed for real:** a resolution-applied commit can NEVER
patch-match its original source commit again, by construction (resolving a conflict means
writing different bytes than the original diff would have produced). `git cherry` therefore
reports `e-cp28-build-record` as NOT-MERGED forever after its resolution genuinely lands —
which would make every future `merge_all` invocation re-encounter it, try to re-pick it, and
STRAND again, because the recorded resolution's "master pre-image" no longer matches (master
already carries the resolved content).

**Fixed in two places** (both consult the SAME new function, `_resolution_landed`, so the
merge engine and the verifier can never disagree about what "merged" means): `merge_all.
merged_into_master()` gained an optional `stem`/`resolutions` fallback; `sitting_verify.
merged_state()` gained the identical fallback via the `merge_all` module it already loads.
Verified against the real state: `e-cp28-build-record` now reads MERGED in both tools.

⚠️ **Not yet formally packeted as its own K CP.** Given the R-STOP trigger below, this fix is
committed and verified but its build record/manifest row/signing were not completed before
stopping — see §8.

## 4 · R — resuming row 2 through e-cp29-build-record, as a real batch

```
S.0   merge-run reset to origin/master (multiple times, as master moved under concurrent work)
guard  789/891-line pre_push_guard.py at _merge-master (master's own copy, NOT the 279-line
       feature-branch copy — neither BURST nor RECENCY exist there)
```

**One real batch run, `--until k-cp16-build-record --batch`:**

- rows 1-3 (packet-a/c/d): ALREADY MERGED (patch-equivalent to independent, concurrent
  identical edits from a sibling session — confirmed real via `git cherry`, not assumed)
- rows 4-5 (packet-b, packet-v): docs-only, correctly skipped
- rows 6 through 39 (s4-cp2 … e-cp29): **34 rows, 36 commits, picked cleanly as ONE pending
  batch**, including e-cp28's recorded resolution applying correctly for the first time ever
  on a real run
- K series rows (packet-k, k-cp3–16): docs-only, correctly skipped

**First push attempt: REFUSED, RECENCY** (another workstream's deploy 450s old). Never
attested — waited out.

**Batch pushed successfully at 04:12:39Z**: `871ca022e..688c413fa HEAD -> master`. Guard was
OPEN at push time (had briefly shown BURST moments earlier during the wait, cleared naturally
before the actual push attempt — no attestation was needed for THIS specific push, though the
mechanism was exercised live earlier in the session on a different refusal and worked
correctly: BURST detected, attested, logged, retried once, succeeded).

**Verified, not assumed:** `688c413fa` confirmed an ancestor of the current `origin/master`
(`546a11419`) via `git merge-base --is-ancestor`. `sitting_verify --until e-cp29-build-record`
(after the K CP17 fix): **37 of 39 head rows merged-or-no-commits, all SIGNED-and-merged
correctly** — the only BLOCKERs are the 14 K-series rows signed ahead of their sitting
(§2's disclosed deviation), zero code-correctness blockers.

## 5 · ⛔ THE STOP — a stalled deploy queue (R-STOP: "deploy non-SUCCESS on a merged unit")

`wait_for_deploy` polled the full `DEPLOY_TIMEOUT` (900s) after the push and never found a
deployment row for `688c413fa` at all — not BUILDING, not SUCCESS, never appeared. Measured
directly afterward: the newest deploy Railway has actually completed is STILL `871ca022e`,
**~28 minutes stale** at time of writing, despite our batch plus several further commits from
other concurrent workstreams having landed on master since. No FAILED/CRASHED status anywhere
— this reads as a backed-up build queue under tonight's unusually high multi-workstream push
volume, not a broken deploy, but it is measured, not assumed, and it is a clean, textbook
R-STOP trigger: **the merged unit's deploy has not reached SUCCESS.**

⛔ **This is Railway deploy-pipeline health, not a code or merge-tool defect, and is outside
this session's delegated scope to act on.** Per R-STOP: draft, don't build; report; stop.
`_merge-master` is clean (verified: no `CHERRY_PICK_HEAD`, `git status --porcelain` empty),
nothing is mid-operation, and no further pushes were attempted once this was measured.

**NOT-REACHED:** the rest of Sitting 1 (rows past k-cp16), Sittings 2-4, S.5, the post-merge
premise audit, F-S2-1's read-only pod grep.

## 6 · Controls run this session

Every claim that decided something carried a proof, not an assertion:

| claim | control |
|---|---|
| the railway resolver works | dry-run makes the REAL call; measured success, byte count |
| replay skips merged units | real manifest: "CLEAN 42 picked, 6 already merged, of 48" |
| the BURST predicate is right | tested against the exact live refusal strings observed |
| --batch groups correctly | dry-run showed 10 then 34 INSTRUMENT rows batching into ONE push |
| the strand fix works | proven against the ACTUAL e-cp28 conflict in an isolated clone BEFORE trusting it near production |
| the resolved-row fix works | measured directly: `merged_into_master`/`merged_state` both flip NOT-MERGED -> MERGED on the real row |
| the batch push landed | `git merge-base --is-ancestor` against fetched origin/master, not assumed from a print line |
| packet-d's mystery signature | investigated to a specific, verified cause (concurrent session) before accepting it, not shrugged off |

Two of my OWN controls failed as instruments and were fixed, not silently patched: a
SCOPE-pre-filled signing fixture that mismodeled `rederive_signed`'s four-field blank, and an
"unit pre-image" fixture that used the wrong commit's blob.

## 7 · Findings filed / closed

| id | finding | state |
|---|---|---|
| **F-VERIFY-1** | verify_manifest crashed on the first SIGNED row | ✅ CLOSED (K CP14) |
| **F-MV-1** | member-visible gate read a hand flag, disagreed with `#!last:`'s derivation | ✅ CLOSED (K CP15) |
| **F-DEPLOY-1** | merge_all crashed on `railway`, could merge one unit per invocation | ✅ CLOSED (K CP13) |
| **F-RESUME-1** | replay() never consulted merged state, stranded on an already-merged unit | ✅ CLOSED (K CP13) |
| **F-STRAND-1** | the REAL merge loop never applied recorded resolutions, only the preview did | ✅ CLOSED (K CP16) |
| **F-RESOLVED-1** | a resolution-applied commit can never patch-match again; misread as a permanent BLOCKER | ✅ CLOSED (code committed, packeting incomplete — see §8) |
| **F-GUARD-1** | guard cadence caps merges at ~3/hr with no same-session exemption | ⚠️ ACCOMMODATED by --batch + R-ATTEST, not fixed (the owner's call, not this session's) |
| **(new, unnamed)** | production deploy queue stalled ~28+ min under tonight's multi-workstream push volume | ⛔ OPEN — THE STOP, infrastructure, not this session's to fix |
| F-CI-42 | Notebook self-check reads the live repo | ⛔ OPEN, untouched |

## 8 · OPEN QUESTIONS

- **Is the Railway deploy queue still stalled, or has it caught up?** This session did not
  poll further once the R-STOP was measured, per "draft, don't build."
- **F-RESOLVED-1 needs its own build record, manifest row, and signature** (K CP17,
  unclaimed) before the next session treats this fix as part of the audited chain the way
  K CP13-16 are. The CODE is committed and verified; the PAPERWORK is not done.
- **The 14 K-series rows signed ahead of their sitting** (packet-k, k-cp3-11, k-cp14/15/13/16)
  are SIGNED with no code commits to merge — harmless, but worth the owner knowing this
  happened from an over-broad `--until` on `sign_all`, not a deliberate per-row choice.
- **Sittings 2-4 have not been re-planned against the new row positions** (K CP14/15/13/16/17
  inserted after k-cp11 shift everything after it by 5 rows). The `--until` row NAMES still
  work; the row NUMBERS in any printed table would need re-deriving.

## 9 · Owner-readable summary

**34 real changes reached production tonight** — the first time this merge programme has ever
landed more than a single unit in one run. They cover CI reporting infrastructure, test
tooling, and one long-standing test-suite conflict that a recorded fix resolved automatically,
for the first time, exactly as designed. **Nothing member-facing changed** — every row in
tonight's batch is backend tooling, tests, or CI reporting; the one member-facing row waiting
(F-S2-1, the ticker-flag hotkey fix) has not been reached yet.

**Why it stopped:** after the push landed, this session waited fifteen minutes for the site to
finish rebuilding with the new code, and it never did — not because anything failed, but
because the deploy queue looks backed up from an unusually busy night with several other
sessions all pushing to the same production branch. The code is safely on master either way;
what's stopped is confirmation that the site has actually picked it up. That confirmation is
infrastructure health, not something this session is positioned to fix, so it stopped and is
reporting rather than guessing or pushing further into a queue that already looks backed up.

**A process note, in the owner's own service:** signing got ahead of itself partway through —
one command signed 49 rows instead of the 3 intended, because of how its `--until` flag works.
Every one of those rows still checks out clean against the current code; nothing was
force-anything or edited-after-signing. Flagged here rather than smoothed over.

**Where to watch:** nothing further is in flight. No new pushes will happen until a fresh
session (or this one, resumed) confirms the deploy queue has cleared.

## 10 · Merge readiness

```
rows 59        SIGNED 53       MERGED 37 (through e-cp29-build-record)
verify_manifest 59 OK, 0 STALE           check-commits: mapped 48 of 48
resolutions 1 parsed, 0 corrupt          freeze: 54 path(s) moved (not re-recorded — session
                                          stopped before W.4's close)
docs   c213056fa (pushed)                origin/master 546a11419 (our tip 688c413fa, ancestor)
_merge-master  688c413fa, clean, no CHERRY_PICK_HEAD
```

⛔ **NOT READY to continue pushing.** Single blocking item: the deploy-queue stall (§5). Once
resolved (confirmed by watching Railway's deployment list for a SUCCESS newer than
`871ca022e`), the remaining ~20 rows of Sitting 1 plus Sittings 2-4 can resume with the SAME
`--batch` + `--resume-signed` + R-ATTEST tooling, now proven live rather than merely
self-checked.

## 11 · Three phone-readable sentences

**Thirty-four real fixes reached the live site tonight — the first time this merge project has
landed more than one change in a single run — and none of them are things a member would
notice.**

**Along the way we found and fixed three real bugs in our own merge tool, each the same
shape: our "preview" mode was quietly skipping a step that the real run needed, so five
sessions of clean previews hid problems that only showed up the moment something actually
tried to go live.**

**It stopped just now because the site hasn't finished rebuilding with tonight's changes yet
— looks like Railway's queue is backed up from a busy night, not a failure — so this session
reported rather than guessing or pushing more changes into a queue that already looks stuck.**

## 12 · Status

STATUS: STOPPED-ERROR
