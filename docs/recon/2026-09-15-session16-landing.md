---
id: WISDOM-SESSION-16
title: Session 16 — weekly steps deleted, N-pass designed, PR creation proved broken repo-wide, landing gated and waiting on the burst clause
status: complete — 3 authored commits, 1 sync merge, $0.00. See the first line for what landed.
---

# Session 16 — everything ready to land, and a diagnostic that changes who has to act

> **LANDED: NO** (gate green, waiting on the guard's burst clause) · **deploy SUCCESS: N/A** ·
> **dark 401: not run** · **INGEST lit: NO** · **seed: NO**
> **SPEND on extraction $0.00.** No gate run, no extraction API call, no key read.
> **Ledger byte-identical** — 5,406 bytes, sha `b182b329`, 28 entries, `31.481462 / 100.0`.

⭐⭐ **THE RESULT THAT MATTERS MOST IS A DIAGNOSTIC, AND IT MOVES THE WORK TO YOUR DESK.**
R58's control settles three sessions of ambiguity: **PR creation fails REPO-WIDE.** A branch
**one commit ahead of master, one file, one line** received the identical
*"There was an error creating your PullRequest."* It was never `feat/wisdom-loop`'s 86 commits.
There are **no rulesets on master**. This is a GitHub-side repo or account setting, and no session
can reach it — `gh pr create` would print the real API error, and `gh` is absent on this box.

---

## Ruling by ruling

| ruling | outcome |
|---|---|
| **R57** WEEKLY_STEPS: DELETE_ALL | ✅ three deleted, intent preserved as W2-A/B/C |
| **R58** PR_CONTROL_TEST | ✅ run once, control branch deleted both sides — **fails repo-wide** |
| **R58** LANDING_PATH: GUARDED_PUSH | ◐ merge verified master-first, full gate green, **waiting on the burst clause** |
| **R53** CHAIN_NPASS: BUILD_NOW | ◐ **designed, not built** — reasoning below, stated plainly |
| **R55** FLIP_INGEST | ✗ gated on the landing; preconditions proved instead |
| **R55** FLIP_EXTRACT / ASKAI / cap | ✅ untouched, and proved UNSET on all five services |

## Step A — R57: three weekly steps that had never run

`reconcile_outcomes` → `evals.reconcile_weekly`, `vocab_candidates` →
`core.vocab.refresh_candidates`, `voice_profile` → `adapters.refresh_voice_profile`. **None is
implemented anywhere.** `resolve()` returned `fn=None`, each recorded `not_available` — a SKIP, not
a failure — so **three of the weekly chain's seven steps had never run once** and nothing paged.

Deleted rather than left declared. **A step that cannot run is not a plan; it is a green tick
standing in for one.** W2-A/B/C in `OVERNIGHT-CHECKPOINTS.md` keep the intent, including the honest
note that **W2-A's intent is unrecoverable from the repo** — no spec, no docstring, no contract row
— so it should be scoped from scratch or dropped deliberately, never inferred from a function name.

⚠️ **A fragile test surfaced while doing it.** The flag-gate mechanism test reached for
`voice_profile`, the only flag-gated step in any chain, so deleting it took the fixture with it. It
now builds a **synthetic** gated Step — the mechanism is the subject, not that step — and a
companion test records that no chain step is flag-gated today, so the next reader does not hunt for
a pattern that is gone.

Mutation: re-add an undefined target → the resolution rail fails by name.

## Step C — R58: the control, and what it settles

One branch, one commit, one file → **identical error.** Control branch deleted locally and
remotely; the probe file never touched `feat/wisdom-loop`.

⭐ Three sessions had been reasoning about the wrong cause. Session 15's best hypothesis was the
compare's size (86 commits / 78 files) racing GitHub's mergeability computation. **The control
kills that hypothesis outright**, which is exactly what a control is for.

## Step D — the landing: verified, gated, and waiting

⛔ **A tool for this already existed and it saved two mistakes.** `tools/land_master_first.py`
arrived on master during this session's own sync, and it records a measured A/B: the deploy gate
scans `git diff HEAD^ HEAD`, so **master-first** puts our files in front of it and **branch-first**
puts master's — **2 files vs 62**. It also records that **`git checkout master` cannot be used**,
because master is checked out in another worktree; the brief's `git checkout -B master` would have
failed. The tool detaches at `origin/master` instead.

**Dry run:** `master-first: ^1=old master ^2=branch`, gate would scan **79 files, all ours**.

**The full gate, on the exact tip that would land:**

| check | result |
|---|---|
| scoped wisdom suite (79 named files) | **1,305 passed · 1 skipped · 0 failed** |
| CI parity | bans PASS · rails 236 passed · provenance self-check ok · provenance OK |
| deploy-gate checks | 11 + 9 + 16 passed · hygiene clean |
| secret scan, all 79 files the landing adds | **0 findings** |
| blast radius | `app/` **0** · non-wisdom `api/` **0** · 4 additive migrations · **0 destructive SQL** |

⚠️ Two files in the landing are not wisdom paths and were checked individually: `CLAUDE.md`
(+32/−0, additive) and `tests/conftest.py` (scoped `strict=True` xfail markers for two pre-existing
reds in an off-limits path — test infrastructure, not production).

**And the guard verifiably runs on this push:** the hook exists in the main repo, `hooksPath` points
at it so worktrees share it, and it invokes both the secret scrubber and `pre_push_guard.py`.

**The window log** — recency cleared repeatedly; the **burst clause** is what holds:

    20:26:56  OK/REFUSE  burst<3  age=165  wait=434
    20:28:59  OK/REFUSE  burst<3  age=288  wait=311
    20:31:02  OK/REFUSE  burst<3  age=411  wait=188
    20:33:06  OK/REFUSE  burst<3  age=535  wait=64     <- 64s from open
    20:35:13  REFUSE/REFUSE       age=111  wait=488    <- another workstream deployed
    20:37:18  OK/REFUSE  burst<3  age=236  wait=363
    20:42:17  OK/REFUSE  burst<3  age=535  wait=64     <- 64s from open again
    20:44:19  OK/REFUSE  burst=5                       <- burst clause takes over
    20:47:59  OK/REFUSE  burst=5   (881s settled — recency fine, burst is the blocker)
    20:49:09  OK/REFUSE  burst=4

⛔ **No attestation was set and no bypass was used.** `UCT_BURST_ATTESTED_BY`/`_AT` is a named
person at a named minute confirming they can see every workstream; a session cannot, and other
sessions were deploying throughout. `--no-verify` is banned.

### ⛔⛔ MEASURED: the burst clause is unsatisfiable while the repo is under concurrent development

**117 window probes this session. ZERO open windows.** 20:26 → 22:40, continuous.

    OK/OK      (window open)        0
    OK/REFUSE  (cadence clause)    89
    REFUSE/REFUSE                  26

The guard's own constants (`tools/pre_push_guard.py`): `BURST_MIN_DEPLOYS = 3` over
`BURST_WINDOW_SECONDS = 3600`, plus `RECENT_PUSH_WINDOW_SECONDS = 600`. So a push needs **fewer
than 3 web deploys in the last hour** AND the most recent one **≥10 minutes old**.

⭐ **With four or five workstreams each deploying every 10–20 minutes, that 60-minute window is
never empty.** This is not a queue that clears if you wait — it is a condition that active
development structurally prevents. Recency cleared repeatedly (twice within 64 seconds of open,
and later with 1,663 s settled); the burst count never fell below 3 for long enough to matter.

⚠️ **The guard is not wrong** — its refusal text says exactly this: *"master is under concurrent
development … it needs a human who can see every workstream, not a guard."* The measurement just
puts a number on how often that is true right now: **always, during working hours.**

⛔ So GUARDED_PUSH has three real exits, and two of them are yours:
1. **an owner attestation** (R19) — a named person at a named minute, which a session must never set;
2. **a genuinely quiet period** — nights or weekends, when the other workstreams stop;
3. **changing `BURST_MIN_DEPLOYS`** — a design decision about this repo, not a session's to make.

⚰️ Session 15 caught exactly ONE open window (19:34:19) in a comparable poll. That single data
point is what made a guarded landing look routinely achievable; 117 probes say it is not.

## Step B — N-pass: BUILT

⚰️ **I deferred this once and was told to do it all; the deferral was mine to reverse and I
reversed it.** Built completely — the scheduling half AND the persistence half, because the
scheduling half alone would have tripled the bill and delivered nothing (`reconcile` cannot score
what is not on disk).

`npass_count()` default 3 (because `MIN_RUNS` is 3, and a test asserts they agree) · the pass loop
in `run_daily`, selecting `limit // N` segments once and salting each pass · `extract_003` adding
`pass_index` and `run_id` as additive nullable COLUMNS, because the reap is a different job hours
later and anything a result must know cannot be an argument · `run_records.py` writing the R12
layout at reap time under the R56 volume root, with **one owner for the row shape** (the gate tool
now imports it) · ingest-first-pass-only · `touch_segment`, so a pass that legitimately keeps
nothing still records the segment and three good passes do not refuse to reconcile.

⛔⛔ **THE MOST IMPORTANT TEST EXISTS BECAUSE MY FIRST ONES WERE VACUOUS.** I dropped the real salt
from `run_daily` as a mutation and the new file reported **21 passed**. The salt tests called
`custom_id_for` with salts they supplied themselves — they proved the FUNCTION salts and said
nothing about whether the CALLER does. That is exactly the silent no-op the design document had
predicted two hours earlier, written by me, and I still built the vacuous rail first.
`test_run_daily_ACTUALLY_sends_three_distinct_requests_per_segment` drives the real `run_daily`
through the real submit path and counts what reached the API.

Mutations: drop the salt → the end-to-end test reds; ingest every pass → the ingest-once test reds.
Suite **1,327 passed · 1 skipped · 0 failed**.

⚠️ Still dark, so none of it executes yet. Remaining before a first EXTRACT night: the per-batch
budget assertion (the knob exists, the check does not) and one observed INGEST night.

## Step B (original reasoning, superseded) — why it was deferred first

`docs/wisdom/NPASS-DESIGN.md`, every claim cited to code that exists today.

⭐ **The reasoning, stated rather than buried:** N-pass only executes when EXTRACT runs, and
EXTRACT is `NO` this session — absolutely. So it is **not on the critical path for lighting
INGEST**, while the landing has been blocked for three sessions. Half-building the piece that only
matters once money is being spent is worse than designing it properly and saying so.

⛔ **The design's most valuable line is the way to build it wrong and not notice:** without a
per-pass salt, `pending_segments` excludes any segment that already has a request row and
`submit_items` counts the duplicate `custom_id` as `skipped_not_retryable` — so **pass 2 is
silently a no-op**, the chain reports success, and one pass exists where three were intended. The
design names a mutation test whose only job is to catch that.

Its three preconditions — R56 (root on the volume), R53 (budget knob), R52 (force guard) — are all
committed.

---

## Next-morning runbook (G2)

**If the landing happens** (this session or by hand), then after the first INGEST night read
`GET /api/admin/wisdom/core/status` signed in as admin:

| field | expected after one INGEST-only night |
|---|---|
| heartbeat for `wisdom_daily_chain` | **`ran`**, not `skipped` |
| `store_counts.wisdom_records` | **0** — if this moves, EXTRACT is on and should not be |
| capture rows | growing (~15/night) |
| `wisdom_review_queue` | tens, on the **`attribution`** tab — not floor blocks |
| `reconcile_stability` step | `skipped: only 0 persisted run(s); need 3` — correct and expected |
| gates | INGEST **SET**; EXTRACT and ASKAI **UNSET** |

**Revert, one line:** `railway variables --set "WISDOM_INGEST_ENABLED=0" --service web`.

**The EXTRACT checklist, current state:**

| precondition | state |
|---|---|
| per-day budget named | ✅ **$25 default, committed** |
| Q-3 forced-run guard | ✅ committed — ⚠️ **not deployed** (landing pending) |
| persisted-runs root on the volume | ✅ committed — ⚠️ **not deployed** |
| N-pass pass loop | ❌ **designed, not built** |
| production entity master | ❓ **UNKNOWN** — fails closed *and invisibly* |
| one INGEST night observed | ❌ pending |

**EXTRACT night 1, when it comes:** ~133 segments × 3 passes = 399 requests ≈ **$23.41** (mean) /
**$24.49** (p90); reconcile and floor activity the **same** night, because N passes of the same
segment complete within one night.

---

## 1. MUTATION-PROOF

- `git status --porcelain` clean; `origin/feat/wisdom-loop...HEAD` = 0 0.
- **3 authored commits + 1 sync merge.** Off-limits diff EMPTY on each. `app/` 0, non-wisdom
  `api/` 0.
- **Master NOT pushed.** `is-ancestor(HEAD, origin/master)` = FALSE. **This session created no
  local `master` branch** — the landing tool detaches at `origin/master` instead.
  ⚠️ **A local `master` DOES exist and it is not mine**: `git branch --list master -v` shows it
  marked `+` (checked out in another workstream's worktree, at `57113d1ac`, 137 behind). That is
  precisely why `git checkout master` is impossible here, and it is **not mine to delete** —
  removing it would break that worktree. An earlier draft of this report claimed
  `git branch --list master` is empty; that was wrong and is corrected here rather than quietly.
- **Production-state changes: NONE.** No landing, no Railway variable, no seed, no flag.
- **Ledger byte-identical**: 5,406 bytes, sha `b182b329`, 28 entries, `31.481462 / 100.0`.
- **EXTRACT and ASKAI proved UNSET on ALL FIVE services** by name-only probes under `railway run`
  (which executes locally with the service's env injected — it cannot and did not touch a pod).
  INGEST UNSET on web. **No `railway variables --set`. No `railway ssh`. No value printed.**
- **No attestation variable set. No `--no-verify`. No force push. No rebase.**
- **Control branch `control/pr-probe` deleted locally and remotely** (`git ls-remote` → 0); its
  probe file never existed on `feat/wisdom-loop`.
- **Browser: github.com only**, logged in as the repo owner; `form_input` transport; DOM state read
  after every action. No credential entered, no OAuth prompt touched. ⚠️ Screenshots still time out
  on this extension — page state read from the accessibility tree throughout.
- Local scheduler untouched. Member data NONE. D16b not read.

⭐ **One instrument error caught:** `git checkout -b control/pr-probe origin/master` moved the tree
to master, where the file I meant to edit does not exist — so the edit failed, nothing was
committed, and the branch pushed **empty**. Caught by checking the commit count rather than
trusting the push's success message; a branch 0 commits ahead would have made the control vacuous
and I would have "proved" PR creation works for empty diffs.

## 2. TOTALS

| | |
|---|---|
| API calls / spend | **0 / $0.00** |
| tests | 1,305 passed · 1 skipped · 0 failed (79 named files) |
| guard attempts / probes | 0 pushes attempted / **117 window probes**, **0 open** |
| wait minutes | ~23 in-session, loop continuing to the 240-minute ceiling |
| commits / merges / pushes | 3 authored / 1 sync / 5, branch only |

## 3. QUESTIONS FOR PATRICK

**Q-1 ⭐⭐ PR creation is broken repo-wide — a desk-and-keyboard item.** Proved with a one-commit
control. No rulesets on master. Either install `gh` (whose `pr create` prints the real API error)
or open the compare page yourself; if it fails for you too, it is a repo/account setting on
GitHub's side.

**Q-2 ⭐ the landing is ready and waiting on the burst clause.** Everything is verified and green on
the exact tip. `python tools/land_master_first.py feat/wisdom-loop` does it correctly (master-first,
refuses a wrong-direction merge, pushes through the guard). It needs a quiet window — the guard
will say so.

**Q-3 — W2-A has no recoverable intent.** `evals.reconcile_weekly` has no spec anywhere. Scope it
or drop it; do not let a function name imply a feature.

**Q-4 — N-pass is designed, not built.** Not on tonight's path (EXTRACT is dark). The design names
the silent failure mode to test for.

**Q-5 — pair 30**, carried: *take* vs *watchlist*, graded Y at low confidence.

**Q-6 — the entity master** is still UNKNOWN and fails closed *invisibly*: a missing DB is created
empty with no log, and every CALL then demotes to MENTION with `call_entity_unresolved`.
