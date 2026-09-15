---
id: WISDOM-PROMOTION-2026-09-15
title: PR body — promote feat/wisdom-loop to master
status: prepared, NOT merged. Patrick merges.
---

# Wisdom Loop — Wave 1.5 promotion (ten sessions)

**Nothing changes for members when this lands.** Every consumer is behind a gate that is unset,
and `0 of 25` gates are SET on production `web` (measured session 9, by child-process exit code).
The daily chain is a no-op dark — proof below.

    feat/wisdom-loop  ->  master
    62 ahead, 0 behind (origin/master merged in at 3eade7269)
    60 files changed, +11,842 / -51
    CI parity: the wisdom-rails job run locally, all four steps PASS
    Scoped suite: 1,189 passed · 1 skipped · 0 failed (69 named files)

---

## What this is

Ten sessions of work that has **never touched master**. Production currently runs the old Wisdom
code, which has **no publication floor at all** — so a flag flip today would be strictly worse than
a flip after this merge. That is why the promotion is the gate, not the flags.

## Changelog by area

| area | what landed |
|---|---|
| **publication floor** (item 3) | `publish/floor.py` — one predicate, four enforcement sites. `MIN_RUNS = 3`, threshold reads `golden.STABILITY_FLOOR`, never a literal. Blocks PRINCIPLE and MARKET_SIGNAL below the floor and enqueues each block to the admin review queue. |
| **N-pass reconciler** (item 2) | `extract/reconcile.py` — folds N persisted runs into `stability = runs_present / N`, matching by KEY per segment, never by text or span. Refuses on extractor_version or segment-set mismatch. **R43: MARKET_SIGNAL's identity is `MERGED_J05`**; `MS_IDENTITY` is the single switch and KEY is retained as the lower-bound comparator. |
| **RQ-v11-001** | `evals/null_review.py` — emits review items for the two judgement types only; changes no number. |
| **run persistence** (R12) | `tools/wisdom/gate_records.py` — every validated record persisted per run, so a scoring bug re-scores offline for $0.00. |
| **dark check** | `scripts/wisdom_dark_check.py` — three exit codes (PASS / LIT / INCONCLUSIVE); gates from `flags.GATES`, routes from `registry.routers()`. |
| **key plumbing** (R32/R34) | the gate carries its own `WISDOM_ANTHROPIC_API_KEY`, so running it never re-authenticates the agent session. OS credential store as a last-resort third source. |
| **admin visibility** (R45) | `GET /api/admin/wisdom/core/status` now also returns store row counts, floored-type stability, and `extractor_version`. **No new route.** |
| **migrations** | four additive columns (below). |
| **docs / rules** | `docs/wisdom/HARD-RULES.md` (§0.4 verbatim + dated rulings), `OVERNIGHT-CHECKPOINTS.md`, ten session reports under `docs/recon/`. |

## Migrations — four, additive, nullable, idempotent

    core_007_records_stability          ALTER TABLE wisdom_records    ADD COLUMN stability REAL
    core_008_records_stability_runs     ALTER TABLE wisdom_records    ADD COLUMN stability_runs INTEGER
    core_009_principles_stability       ALTER TABLE wisdom_principles ADD COLUMN stability REAL
    core_010_principles_stability_runs  ALTER TABLE wisdom_principles ADD COLUMN stability_runs INTEGER

**They apply on the first web boot after merge.** `api/main.py:3244-3245` calls
`registry.init_stores()` → `store.init_db()` inside the FastAPI lifespan, **unconditionally and
ungated** (`api/main.py:3241-3242` states the intent: a reader must never depend on a flag to find
its tables).

⭐ **Proved idempotent by running the real runner twice against a throwaway SQLite**: pass 1 applied
24 migrations including these four; pass 2 applied **0**. One statement per migration is deliberate
(`schema.py:17-19`) — a two-statement script that died after its ALTER would retry forever on
"duplicate column". Nullable with no DEFAULT is also deliberate (`schema.py:66-69`): NULL must
fail closed, `DEFAULT 0.0` would be indistinguishable from a measured zero, `DEFAULT 1.0` would
publish everything unmeasured.

## What changes for members: NOTHING

Every consumer of `wisdom_records` is behind an unset gate — Ask-AI
(`ASKAI_WISDOM_RETRIEVAL_ENABLED`, the only member-visible one of the five), Brain KB, dossier,
Model Book drafts, badges, desk markers, PV examples, level alerts, lookalike, weekly report.
⚠️ Clips has **no flag** and is gated only by `require_push_secret` (`adapters/routes.py:160`).
27 Wisdom GET routes return 401 anonymously.

### The daily chain is a no-op dark — the outer proof

`registry.py:200-202`: if `WISDOM_INGEST_ENABLED` is off, the job is skipped before `run_chain` is
entered, and `wisdom_daily_chain`'s own `enabled` is `flags.ingest_enabled` (`publish/jobs.py:35`).
**So the 18:47 ET tick with everything dark writes one heartbeat row and nothing else.**

⛔⛔ **AND ONE THING THE FLAG PLAN MUST KNOW:** chain step 1, `capture`, consults **no gate of its
own**. `WISDOM_CAPTURE_ENABLED` gates the *standalone* capture jobs (`capture/jobs.py:46`), not the
chain step. So `WISDOM_INGEST_ENABLED` alone is what starts capture — the master switch is not a
prerequisite for a second flip, it **is** the flip. Steps 2–12 each carry their own gate or are
no-ops on an empty store.

## What changes for the owner

- `GET /api/admin/wisdom/core/status` gains `store_counts`, `floored_stability`,
  `extractor_version`. This is how production's `wisdom_records` count gets read for the first
  time — it has never been measured.
- The admin review queue gains `below_publication_floor` items once records exist.

## Risks and mitigations

| risk | mitigation |
|---|---|
| Migrations fail on production's store | Additive nullable columns, idempotent, proved twice. A failure leaves the column absent and the floor **fails closed** (NULL stability blocks). |
| `api/main.py:3247-3248` swallows a total store-init failure into one WARNING | Pre-existing behaviour, not introduced here. Post-merge check: the admin status route returns `migrations` — if the four are listed, they applied. |
| The chain does something unexpected at 18:47 ET | It is skipped entirely while `WISDOM_INGEST_ENABLED` is unset. Verify with the admin route's `master_switch_on: false`. |
| A consumer reads records that should be floored | Four enforcement sites share one predicate; behavioural tests at each. Clips is push-secret-gated, not flag-gated — noted, unchanged by this PR. |
| Route surface grew | It did not. 27 GET routes before and after; R45 extended an existing route. |

## Rollback

**Revert the merge commit.** The migrations are additive nullable columns and are **safe to
leave** — nothing reads `stability` except the floor, and with the code reverted nothing reads it
at all. There is no data migration to undo and no backfill to reverse.

## Post-merge verification checklist

1. `python scripts/wisdom_dark_check.py --host https://uctintelligence.com` → expect **27/27 → 401**, exit 0.
2. Open `https://uctintelligence.com/api/admin/wisdom/core/status` signed in as admin. Expect
   `master_switch_on: false`, the four `core_00[7-10]` migrations listed, and `store_counts` —
   **the first reading of production's Wisdom store.**
3. At the next 18:47 ET window, re-read the route: `jobs[].heartbeat` for `wisdom_daily_chain`
   should show a **skipped** beat and `store_counts` should be unchanged.
4. Then, and only then, the flag plan below.

## Flag plan (nothing is flipped by any session)

**First flip — one switch, not three:** `WISDOM_INGEST_ENABLED`. Because the chain's capture step
carries no gate of its own, this single flip starts capture; `WISDOM_CAPTURE_ENABLED` and
`WISDOM_SOURCES_INGEST_ENABLED` govern the standalone jobs and the sources half respectively and
can follow.

⛔ **`WISDOM_EXTRACT_ENABLED` stays dark** — it is the only switch that spends.
⛔ **`ASKAI_WISDOM_RETRIEVAL_ENABLED` stays dark** — it is the only switch that makes anything
member-visible.

**What to read the next morning** from the admin route: `store_counts.wisdom_sources` and
`wisdom_segments` should be non-zero and growing; `wisdom_records` should stay **0** (nothing
extracts); `wisdom_review_queue` should stay flat. If `wisdom_records` moves, EXTRACT is on and
should not be.

**The condition for flipping EXTRACT**, and it is a number: at the measured rate of
**$0.058671/segment**, a day's capture of N segments costs `N × $0.0587`. The ledger has
**$8.5185** of headroom under the ruled $40 cap, which funds about **145 segments** — one modest
day. So EXTRACT is worth flipping only once (a) a per-day budget is ruled, (b) the R36 reservation
fix is live, and (c) the cap covers at least one day's throughput at that rate.

---

## How to open this PR

`gh` is not installed on this box, so the PR was not created automatically. From a machine with it:

    gh pr create --draft --base master --head feat/wisdom-loop \
      --title "Wisdom Loop — Wave 1.5 promotion (floor, reconciler, RQ-v11-001, migrations)" \
      --body-file docs/wisdom/PROMOTION-2026-09-15.md

⭐ **Or from the GitHub mobile app**: open the repo → Pull requests → New → base `master`, compare
`feat/wisdom-loop` → paste this file as the body. The app can also **merge** it.

⚠️ **Two gate facts before merging:**
1. **The clock guard refuses a daytime master push.** `tools/pre_push_guard.py` clears only
   `docs/ tests/ tools/ scripts/ app/` and `.md`; this branch changes **13 files under `api/`**, so
   a push to master is refused between 09:25 and 16:05 ET on a trading day. Merge after 16:05 ET,
   at a weekend, or through the GitHub UI (which is not the local hook's path).
2. **The queue guard** requires Railway `web` to be SUCCESS and settled ≥ 150 s before the next
   master push. It needs the Railway CLI and was not evaluated here.
