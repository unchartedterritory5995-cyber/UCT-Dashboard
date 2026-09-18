---
title: Session 27 — cost levers, measured for real; Sonnet partial; nothing armed
status: Sonnet $0.7680 of $2.00 spent. Prescreen/targeted-N/output-cap MEASURED, not armed.
---

**First line: Sonnet 30% cheaper than Opus per segment (not 5x), quality unmeasured at N=19 ·
pre-screen 8.9% skip rate (not 40-60%), 0% recall loss on the 83-segment golden split · targeted-N
density 31.3% could skip repass · output-cap savings real but unquantified without more spend ·
cheapest goal-buying configuration: Opus + prescreen + targeted-N, ~$2,300-3,500 · DONE: NO —
nothing armed, holding for the owner's ruling on the new table.**

---

## Why this session exists

Session 26 armed `WISDOM_EXTRACT_ENABLED=1` (N=3, Opus only, 6,000 req/night, ~$352/night
projected). Before that ran its first night, the owner asked to stop defending the $1,500-4,900
full-corpus estimate and attack it: every choice in "the dumbest version of the job" — most
expensive model, every segment including hours of narration, three passes regardless of yield,
uncapped output — has a lever. This session priced six of them for about $0.77, real spend, before
arming anything further.

## Step 0 — the conflict with Session 26, resolved before anything else

Session 26's Opus N=3 run was still armed and scheduled to fire at 18:47 ET the same evening this
session's investigation began — spending real money from the same $1,800 pool this session was
trying to shrink, under exactly the assumptions being challenged. Asked the owner explicitly
rather than guess either direction (silently letting it fire risks spending against premises under
active review; silently killing it reverses a deliberate recent decision). Owner chose to pause.
`WISDOM_EXTRACT_ENABLED=0` set, deploy-watched, verified in-process (`flags.extract_enabled()` ->
`False`, `spend_allowed()` on the exact scheduled-run shape -> `False`) before proceeding.

## Step A — Sonnet golden run: real spend, real interruption, real recovery

Dry-run confirmed 83 segments, distinct version stamp (`wx-v0-claude-sonnet-5-fc47bc97`, R80
working correctly for a third model), $0.17/request worst-case reservation. Launched via nohup,
in-container, `--max-usd 2.0`, reusing session 25's Haiku sample/golden files already on the pod's
scratch path (no re-transfer needed).

**Round 1 (11 segments, $0.5936 actual) completed and was collected.** Round 2 (8 segments)
submitted, then the container restarted mid-run — Railway's "sleep when idle," the same incident
class this project has hit before (`incident_web_bars_coverage_collapse_2026_08_25`). Both batches
survived on Anthropic's side (batches are async and server-side, confirmed by direct
`.retrieve()`), but this session's own tracking DB and ledger were under `/tmp` — ephemeral
container filesystem, wiped by the restart — rather than `/data/wisdom/scratch/`, the persistent
volume. **Operator error, not an infrastructure failure**: `/tmp` was fine for the read-only
sample/golden data (already correctly staged from session 25), wrong for anything that needs to
survive a restart.

**Recovery, without resubmitting or double-charging anything:** `extract_golden_gate.py`'s
`run_batch_round` builds custom_ids as `g{phase[:1]}{round:02d}x{i:03d}` where `i` is the
chunk-local index and `chunk` is a deterministic slice of `load_gate_segments()`'s sorted output —
traced from source, not assumed. Round 1's 11 custom_ids map to `items[0:11]`, round 2's 8 to
`items[11:19]`. Re-loading the golden set (same data-dir, same golden file — deterministic) and
re-fetching both batches' results by ID reconstructed the exact segment correspondence. Verified:
`b.processing_status == "ended"` and `succeeded` counts matched before trusting anything.

**Real numbers, 19 of 83 segments:**
- Total actual cost: $0.7680. Real rate: $0.0404/segment.
- Opus's own real rate (gate-run-3, all 83, pass 3): $0.0574/segment.
- **Sonnet measured ~30% cheaper than Opus, not the ~80% cheaper the "roughly a fifth" framing
  implied.** `claude-sonnet-5` is 2.5x cheaper than Opus per token on paper ($2/$10 vs $5/$25);
  the real-world gap is much smaller because Sonnet generates proportionally more output for this
  specific extraction task.
- Projected full-83-segment cost at this rate: ~$3.35 — over the $2.00 hard cap, so this session
  did NOT continue spending to complete it.
- Informal per-type table (N=19, NOT recorded to `wisdom_eval_runs` — `complete()` requires all 83
  scored before anything is recorded) is in `docs/wisdom/COST-REDUCED-PRICING-2026-09-18.md`.
  Per-type predicted counts are single digits (0-7) — **too small to answer R101_CLEAR_RULE**.
  Completing a real, recordable verdict needs ~$2.58 more (the remaining 64 segments at the
  measured rate), which is a budget decision for the owner, not this session's to make.

## Step B — lexical pre-screen: real skip rate, much smaller than hoped

Moved the golden-v1.1 lexical screens (`null_screens`, seven regex-based checks: cashtag,
uppercase-shaped ticker, company name, sector word, price token, principle vocabulary, signal
vocabulary) out of `tools/wisdom_golden_verify.py` into `tools/wisdom/null_screens.py`, the same
R15 extraction pattern `category_norm.py` already established — one authority, two callers,
re-exported for backward compatibility. `--self-check` passes unchanged after the move (18/18
checks), proving behaviour-preservation directly rather than by inspection.

Built `api/services/wisdom/extract/prescreen.py` (`is_candidate`, `prescreen_enabled`), wired as
an optional filter inside `pending_segments` (`_apply_prescreen`, applied after the R100 priority
sort, before truncating to the night's limit). `WISDOM_EXTRACT_PRESCREEN_ENABLED` defaults OFF.
22 new tests (`test_wisdom_null_screens.py`, `test_wisdom_extract_prescreen.py`), all passing;
R100's own priority-selection tests re-run unchanged to confirm the disabled-by-default path is
truly a no-op.

**Measured on the local sample corpus** (383 sources, 9,733 segments — this is the OLD
catalog-estimate corpus, not the 26,675-segment real production one; the local raw-text mirror was
never re-pulled at the larger size, so treat the skip RATE as representative and the segment
COUNTS as stale by roughly 2.7x): **8.9% of segments skip, not the hoped-for 40-60%.** The screen
fires on any of seven signals, and trading-show narration is full of price levels and ticker
mentions even where no record is ultimately constructed — the screen is deliberately loose
(golden-v1.1's own design: absence must be the SAFE claim), and that looseness caps its value as a
cost lever. Recall-loss bound on the golden dev split: 0% (every non-null golden record across all
six types fell in a segment the screen would keep) — a good trust signal, measured on a small
(83-segment) split.

## Step C — targeted N: density measured, production wiring NOT built

Measured directly from gate-run-3's real 3-pass data: 57 of 83 segments (68.7%) produced at least
one floored-type record on pass 1 alone (identical whether measured on pass 1 alone or across all
3 passes, because the model's true positives are pass-to-pass stable — session 4's own finding).
**31.3% of segments could skip passes 2/3** under R103's design, saving roughly 20.9% of total N=3
spend. R103's own ruling was BUILD; this session measured instead, because 31.3% is a real but
modest return relative to the engineering change (a new pass-scheduling path through `batch.py`'s
N-pass loop) — the owner should see the number before that gets built.

## Step D — output cap: real distribution, savings NOT reliably quantified at $0

Real output-token distribution from gate-run-3 (249 request-passes): p50 2,259, p90 10,376,
p95 12,222, p99 15,522, max 18,857. A pessimistic (worst-case: truncation loses the WHOLE
request's yield, not just its tail) table shows a p95-p99 cap trims the top 1-3% of requests at a
theoretical cost of ~3-10% of kept records — but production already retries a `max_tokens` stop one
effort level lower, so the real loss is almost certainly much smaller than this bound. Quantifying
the real number needs a real re-run at a candidate cap, which was out of scope for a $0 step.
Recommendation only, not implemented: a cap around p97-p99 (~14,000-15,500 tokens). Digest-neutral
(a request-shape parameter, not a schema field) — usable without a new golden run once measured
for real.

## Step E — cache audit

Opus's own gate-run-3 calibration already shows `cache_read_share: 0.7594` — caching is
substantially working. No further lever identified.

## The pricing discrepancy, resolved and filed

Anthropic's own pricing page (fetched 2026-09-18): Sonnet 5 is $2/$10 per MTok (Sonnet 4.6 legacy
is $3/$15). `budget.py`'s Sonnet row ($2/$10) is correct and needed no change.
`api/services/catalyst/cost_guard.py`'s Sonnet-5 row ($3/$15) duplicates the 4.6 legacy price —
wrong, filed in HARD-RULES for its owner (a different subsystem), not fixed here.

## Mutation-proof checklist

- **Paid calls this session: the Sonnet gate run only.** Two real batches
  (`msgbatch_01Ljxin1KDzHLxzThzoftfPC` 11 requests $0.5936, `msgbatch_01VToAg3KGNVpENbMqZPDLTA`
  8 requests, combined $0.7680 total) against the $2.00 cap. No other paid call was made.
- **No arming.** `WISDOM_EXTRACT_PRESCREEN_ENABLED` unset (default off, verified by test).
  `WISDOM_EXTRACT_ENABLED` left at `0` (paused per Step 0, not re-armed).
- **Production writes: none this session** beyond the Step 0 pause/verify already covered in the
  session-26 record and the code landed for R102 (prescreen, dark). No `wisdom_eval_runs` row was
  written for the partial Sonnet sample — deliberately, since `complete()` correctly refuses it.
- **Doors**: untouched, all False (not re-checked this session beyond Step 0's own verification,
  since nothing in Steps A-F touches a member-facing flag).
- **No corpus text in the repo or a report.** Every script that touched `segments.jsonl`,
  `golden-v1.1.jsonl`, or the local sample corpus read ONLY `usage`, `kept`, `counts`,
  `record_type`, and `segment_id` fields — never `text`, `quote`, `statement`, or `expected`
  content. The two new pricing docs and this recon file were read back before commit to confirm no
  quote-bearing text is present.
- **No `C:\data`**: not touched.
- **Member data**: none touched.
- **D16b**: not read.
- **Every command**: run via this session's own Bash/PowerShell tool calls, output inspected
  before the next step — including the two moments (the container restart, the per-request cost
  coming in higher than the naive 2.5x-price-ratio estimate) where a result contradicted
  expectation and was investigated rather than assumed away.

## What's still open

- **R95 with the new table**: does the owner want to (a) fund the remaining ~$2.58 to get a real,
  recordable Sonnet gate verdict, (b) proceed on Opus + prescreen + targeted-N without Sonnet,
  or (c) something else.
- **R106 monthly line**: unset. The table above prices "the whole corpus" and "new sessions only"
  as two separate rows; a monthly figure needs the owner's number to re-slice against.
- **Nothing else.** No third question — this session was scoped to price levers, not to decide
  among them.
