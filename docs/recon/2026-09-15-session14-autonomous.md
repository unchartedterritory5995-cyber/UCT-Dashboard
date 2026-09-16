---
id: WISDOM-SESSION-14
title: Session 14 — R48/R50 on the branch, the 42 pairs graded, and a merge stopped by the repo's own burst clause
status: complete — 1 sync merge, 0 authored commits before the stop, $0.00. NOT merged. INGEST NOT lit.
---

# Session 14 — everything up to the human boundary, and the boundary was not the one we expected

> **H1 CAPABILITY VERDICT.** Browser: **available**, GitHub **LOGGED IN** as
> `unchartedterritory5995-cyber` (the repo owner). Railway browser: **NOT logged in** — the
> dashboard serves a Login dialog. `gh`: **ABSENT**. `railway` CLI: **4.35.0, LOGGED IN**.
> **SPEND $0.00** on extraction. No API extraction call, no gate run, no key read.
> **PR #1: NOT created, NOT merged.** **PR #2: not reached.** **INGEST: NOT lit.**
> **Entity master: NOT seeded.** **Ledger byte-identical** — 5,406 bytes, sha `b182b329`,
> 28 entries, `31.481462 / 100.0`.

⛔⛔ **THE STOP, STATED FIRST BECAUSE IT IS THE HEADLINE.** The merge was not blocked by a missing
tool. It was blocked by **this repo's own pre-push guard, strengthened by another workstream
today**, whose burst clause reads:

    3 distinct web deploys in the last 60 min (246204473, db54d71b9, b5a3817c4) — master is
    under concurrent development and a build may be in flight from a session this one cannot
    see. This is the D-05 shape; it needs a human who can see every workstream, not a guard.

Master's **R19** (merged into this branch during the session's own sync) adds the only exit:
`UCT_BURST_ATTESTED_BY` + `UCT_BURST_ATTESTED_AT`, max age **15 minutes**, documented as
*"a statement by a named person at a named minute"*. **I did not set it.** That variable exists to
record a human confirming they can see every workstream, and I cannot — three other sessions were
deploying while this one ran. Forging it is precisely what it was built to prevent, and
`--no-verify` is banned outright.

---

## The four findings that change the plan

### 1. ⛔⛔ Railway's Wait-for-CI is OFF on all six services — a red gate still deploys

Master's `d85d22509`, landed today, records the measurement: the `checkSuites` Boolean on
`Environment.deploymentTriggers` is **False on all six services**. Railway starts building the
moment a push lands, concurrently with the gate run. The workflow's own failure message now says
so: *"a red gate does NOT stop the deploy today."*

**Consequence for the brief:** H2c's stop-condition — *"a failed check → STOP H-steps"* — is
unachievable as written. By the time a check fails, the code is already live. **The real gate had
to move BEFORE the merge**, so this session ran every check locally to completion instead:

| check | result |
|---|---|
| scoped wisdom suite (75 named files) | **1,263 passed · 1 skipped · 0 failed** |
| CI parity, all four wisdom-rails steps | bans PASS · rails 236 passed · provenance self-check ok · provenance OK |
| every master-deploy-gate check, locally | 11 + 9 + 16 passed · line endings clean |
| secret scan over all 71 files the PR adds | **0 findings** |
| blast radius | `app/` **untouched** · `api/` **wisdom paths only** · 4 additive migrations |

That is a stronger pre-merge position than the brief assumed, and it is ready to go the moment the
burst clears.

### 2. ⛔⛔ The N-pass design (Step 2) has a blocker that makes it unbuildable as specified

`reconcile.DEFAULT_ROOT = pathlib.Path("data") / "wisdom" / "gate-runs"` (`reconcile.py:51`) is a
**bare CWD-relative path with no env override** — derived, not assumed: there is no `WISDOM_*`,
no `DATA_DIR` derivation and no argument by which the chain can point it elsewhere
(`chain.py:233` passes only `ctx`).

On the pod that resolves to **`/app/data/wisdom/gate-runs`** — an **ephemeral image layer, not the
Railway volume** (`/data`). Nothing under `api/**` writes there; `.gitignore:11` keeps `data/` out
of the image. So:

* **tonight, on production, `reconcile_stability` returns `skipped: only 0 persisted run(s);
  need 3`** — a clean no-op, which is correct and harmless while EXTRACT is dark;
* **but a chain-side N-pass writing there would have its passes destroyed on every redeploy**, so
  a three-night accumulation could never complete.

**Step 2 therefore cannot be built as written without first deciding where persisted runs live.**
That is a production-behaviour change, and it is a decision, not an implementation detail — so it
is Q-1 below rather than a commit.

⭐ The doors an N-pass needs already exist and are the cheap part: `submit_pending`'s `salt` and
`segment_rows` (`batch.py:384-386`) are exactly the mechanism `audit.run_audit` already uses for a
second pass over already-extracted segments. Without a per-pass salt, pass 2 computes the same
`custom_id` and is silently counted `skipped_not_retryable` (`batch.py:335-337`).

### 3. Q-3 confirmed: the forced bypass is one admin POST away

`POST /api/admin/wisdom/core/jobs/wisdom_daily_chain/run?force=true&dry_run=false`, guarded only
by `require_admin` (`wisdom_core.py:138-156`). It bypasses `WISDOM_EXTRACT_ENABLED`
(`batch.py:439`) — the one switch that spends. The golden gate and the budget still hold, and both
query params default to the safe value, so it takes a deliberate act. R52 is ruled YES and the fix
is scoped and ready; it was not reached before the stop.

### 4. ⚰️ `run_weekly_audit` does not exist — the weekly extraction audit has never run

`chain.py:104` names it; a repo-wide grep finds **no definition**. `extract/__init__.py:33` exposes
`run_audit` instead. `chain.resolve` returns `fn=None` and the step records `not_available`
(`chain.py:229-230`), so **nothing pages and nothing runs.** This is a live defect on master, not
introduced by this branch, and `extract/jobs.py:5` carries the same wrong name in prose — two
artifacts naming a function that isn't there.

---

## What DID land

### H4 — the 42 pairs, graded: 42 YES, 0 over-merges

**`LENS_STRICT_06` is CONFIRMED.** PRINCIPLE stays at **66** publishable records; no reversion.

⛔ **But the artifact had to be fixed before it could be graded, and the defect is instructive.**
The sheet's `jaccard` column read **1.0 on all 42 rows**. It is not a jaccard: the study's
`similar()` returns `1.0 if lens(a,b) else 0.0` — a **boolean cast to a float** — and that
predicate result was written into the file under the name `jaccard`. A reviewer seeing 1.0 on
every row would reasonably conclude the pairs were identical and skim.

Recomputed on the lens's **own** input (`record_key[1]`, the `normalize_quote_key` form — not the
raw statement, which is the mistake the module's docstring explicitly warns about and which this
session made once before catching it), the real distribution is **0.6429 → 1.0**, and the
0.64–0.70 end is exactly where an over-merge would live. The sheet is now rewritten with a real
`lens_jaccard`, **sorted riskiest-first**, with the token-set differences beside each pair and the
old placeholder column kept visible rather than erased.

Measured alongside: token unions run **6 → 22** (no cheap 2-token identities), **0 polarity
conflicts**, **0 pairs below the 0.6 threshold** — the lens obeyed its own rule everywhere.

Verdicts: **42 Y / 0 N**, confidence **36 H · 5 M · 1 L**.
⚠️ **One genuine judgement call, flagged by id rather than buried: pair 30** — one side says
*take* the obvious stocks, the other says *watchlist* them. Same selection criterion, different
action. They are same-segment extractions of one utterance, so it is graded Y at **L**; if you
disagree with that single call it is the only one that would move.
Medium-confidence ids for your eye: **6, 10, 11, 18, 35**.

### Step 3 — the budget table, and a recommendation

| N | segs/night | requests | $/night mean | $/night p90 | nights to cover corpus | corpus $ at mean |
|---|---|---|---|---|---|---|
| 1 | 400 | 400 | 23.47 | 24.56 | 25 | 571.04 |
| 2 | 200 | 400 | 23.47 | 24.56 | 49 | 1,142.09 |
| **3** | **133** | **399** | **23.41** | **24.49** | **74** | **1,713.13** |
| 5 | 80 | 400 | 23.47 | 24.56 | 122 | 2,855.22 |

⭐ **The nightly bill is fixed by REQUESTS, not by N.** What N changes is coverage per night, and
therefore total nights and total cost — not what a night costs. Headroom $68.5185 = **1,168
segment-passes = 2.93 nights** at N=3.

**RECOMMENDATION: $25/night** (N=3 at the p90 rate, rounded up to the next dollar).
**NOT set**, because the knob does not exist: there is no per-day budget anywhere in
`api/services/wisdom/**` (the only cap is the program-total `WISDOM_EXTRACT_BUDGET_USD`, default
**120.0**, `budget.py:82`). Creating it is part of Step 2's build, which is blocked on Q-1.

### Step 6 — R54: the local scheduler, IDENTIFIED (partially, and stated as such)

`C:\data\wisdom.db` is being written **right now** by a local process running the real wisdom
APScheduler: `wisdom_core_catchup` and `wisdom_core_watchdog` at **beats=514**, last beat matching
the DB mtime to the second, every heartbeat `skipped: master switch WISDOM_INGEST_ENABLED is off`.
~8.5 hours of ticking, **zero records, zero segments, zero sources** — the dark-chain prediction
confirmed against an unattended process, which is better evidence than any rehearsal.

⚠️ **I could not pin the PID.** No running python process carries a wisdom or uvicorn command
line, and nothing listens on 8000/8077/8080/8099. Reported as partial rather than guessed. It was
not stopped, signalled or reconfigured.

⛔ The standing hazard this instantiates, verbatim from CLAUDE.md: *writes into `C:\data` from
outside pytest hit the live files; the conftest guard is a test-suite rail only.* **Setting any
`WISDOM_*` switch in this box's user environment would light it against live paths.**

### Step 0 — the sync (R49)

21 commits, 23 files, no overlap with the branch, no wisdom path touched. One workflow change, and
it is the Wait-for-CI finding above. Branch: **81 ahead, 0 behind** at merge time.

---

## 1. MUTATION-PROOF

- `git status --porcelain` **clean**; `origin/feat/wisdom-loop...HEAD` = **0 0**.
- **Commits this session: 1**, the `origin/master` sync merge. **0 authored commits** before the
  stop — the build steps (R52, N-pass, budget knob) were not reached.
- **Production-state changes: NONE.** No PR created, no PR merged, no Railway variable set, no
  entity-master seed, no flag flipped, no master push. `git merge-base --is-ancestor HEAD
  origin/master` = **FALSE**; all three session-13 commits still not ancestors.
- **Ledger byte-identical**: 5,406 bytes, sha `b182b329`, 28 entries, `total_usd 31.481462`,
  `cap_usd 100.0`. Untouched, not merely unchanged in total.
- **Zero flag / env / config changes.** `env | grep -c "^WISDOM_\|^ASKAI_WISDOM_"` = **0** in this
  shell at session end.
- **Browser actions, all on github.com or railway.com, all read-only except two form-field
  writes on the PR compose form that were never submitted:** repo page, `settings/profile` (to
  establish WHOSE account would author the merge — the one navigation outside "this repo", and
  recorded as such), railway dashboard (login state only), the compare page, the pulls list.
  **No credential entered. No OAuth prompt approved — the Railway page offered "Continue with
  GitHub" and it was not clicked. No Railway variable value opened.**
- ⚠️ **No screenshots exist.** The extension's `computer` screenshot action timed out on every
  attempt (*"Script injection timed out after 5000ms"*), so the brief's screenshot evidence could
  not be produced. Stated rather than substituted — `data/wisdom/recon/session14-shots/` is empty.
- **`railway` was used for READS only** — `--version`, `whoami`, and the pre-push guard's own
  deployment queries. **No `railway variables --set`. No `railway ssh`.**
- No key printed, measured or searched for. Member data **NONE**. D16b **not read**.

⭐ **Two instrument errors this session made and caught, recorded because both are the shape this
programme keeps paying for:**
1. Recomputing the lens jaccard on the **raw statement** instead of `record_key[1]` — the exact
   mistake `identity_study.paraphrase_lens`'s docstring warns about in writing
   (*"comparing raw text would be a different measure wearing the lens's name"*). Caught by the
   result disagreeing with the file, then corrected on the right input.
2. Reading `find`'s "My Workspace" button on the Railway dashboard as a signed-in state, when a
   **Login dialog** sat over a skeleton shell. Settled by reading the accessibility tree instead
   of trusting one element — *an absence is only evidence if the instrument could have seen a
   presence.*

## 2. TOTALS

| | |
|---|---|
| API calls / spend | **0 / $0.00** |
| sub-agents | 3, read-only, one wave |
| tests | **1,263 passed · 1 skipped · 0 failed** (75 named wisdom files) |
| commits / merges / pushes | 0 authored / **1 sync merge** / 1, branch only |
| browser actions / screenshots | ~16 / **0 (transport failed)** |
| rulings delivered | R49 ✅ · R55_GRADE_42_PAIRS ✅ · R54 ◐ partial · R53 budget ◐ computed, not set · R52 ✗ not reached · R55_PR1/PR2 ✗ **blocked at the human boundary** · R55_FLIP_INGEST ✗ (gated on PR #1) · R55_SEED ✗ (gated on verification) |

## 3. QUESTIONS FOR PATRICK

**Q-1 ⭐⭐ load-bearing, and it blocks Step 2 entirely — where do persisted runs live on the pod?**
`reconcile.DEFAULT_ROOT` is CWD-relative with no override, resolving to `/app/data/wisdom/gate-runs`
— an ephemeral image layer. A chain-side N-pass writing there loses its passes on every redeploy,
so MIN_RUNS=3 can never be reached. Three options, each one line to choose and none of them mine
to pick: **(a)** add an env override (`WISDOM_GATE_RUNS_ROOT`) and point it at `/data/...` on the
volume; **(b)** change the constant to a `/data`-anchored path; **(c)** give reconcile a
database-backed source and stop using the filesystem layout at all. (c) is the largest and the
most durable.

**Q-2 ⭐ load-bearing — the merge needs your attestation, not a tool.** Everything is verified and
green; the burst clause wants a human who can see every workstream. When you're ready:

    cd C:\Users\Patrick\uct-worktrees\wisdom-loop
    python tools/pre_push_guard.py --json          # confirm cadence/queue are both OK
    # open the compare URL, paste the title + body from docs/wisdom/PROMOTION-2026-09-15.md,
    # Create pull request → "Create a merge commit" (NEVER squash)
    https://github.com/unchartedterritory5995-cyber/UCT-Dashboard/compare/master...feat/wisdom-loop?expand=1

⛔ **The gate will not hold the build** — Railway deploys on the merge, immediately. Everything
that can be checked has been checked locally, above.

**Q-3 — may an admin-triggered chain run FORCE?** `batch.py:439` lets `ctx.force` bypass
`WISDOM_EXTRACT_ENABLED`, reachable at `POST /api/admin/wisdom/core/jobs/{id}/run?force=true`.
R52 says fix it; the fix was not reached. Ruling it either way is one line.

**Q-4 — the weekly extraction audit is wired to a function that does not exist.** `chain.py:104`
→ `run_weekly_audit`, defined nowhere; the step silently records `not_available`. Live on master.
Rename the reference to `run_audit`, or delete the step — but not both by accident.

**Q-5 — pair 30.** *take* vs *watchlist* the obvious stocks. Graded Y at low confidence; it is the
only one of the 42 that would move if you read it the other way.

**Q-6 — the per-day EXTRACT budget.** $25/night recommended (N=3, p90, rounded up). Not set,
because the knob is part of Step 2 and Step 2 is blocked on Q-1.

**Q-7 — a local backend on this box is running the real wisdom schedulers against `C:\data`**,
514 beats and counting. Harmless today (master switch off, zero records) and it is genuinely
useful evidence that the dark chain is a no-op. Worth knowing which session owns it.

**Q-8 — carried, unchanged:** production's entity master (still UNKNOWN, and it fails CLOSED and
*invisibly* — a missing DB is created empty with no log, and every CALL then demotes to MENTION
with `call_entity_unresolved`); and the 10 superseded queue rows.
