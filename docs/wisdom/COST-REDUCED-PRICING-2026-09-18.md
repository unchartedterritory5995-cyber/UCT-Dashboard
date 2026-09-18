---
title: Session 27 — the cost levers, measured for real
status: Sonnet spend $0.7680 of a $2.00 cap. Nothing else armed. Nothing else spent.
---

# The headline, first

**Every lever moved the number less than hoped, and none of them is free of a real tradeoff.**
Stacked, they plausibly cut the Opus N=3 full-corpus estimate by roughly a quarter to a third —
from ~$4,900 (p90) toward **~$3,200–3,700** — not to "the low hundreds." Sonnet may add a further
real but smaller saving *if it clears the golden gate*, which this session could not afford to
find out for certain. Nothing here is bad news exactly — every number is real, measured, and
better than not measuring — but the arithmetic the previous brief hoped for does not survive
contact with production data.

## 1. Sonnet — real, but not 5×

**Spent: $0.7680 of the $2.00 cap, on 19 of 83 golden dev segments — real API calls, real
batches, recovered and verified against Anthropic's own batch records after an infrastructure
interruption (below).**

| | measured |
|---|---|
| Sonnet $/segment (N=19, real) | **$0.0404** |
| Opus $/segment (gate-run-3 pass 3, N=83, real) | $0.0574 |
| Sonnet vs Opus | **~30% cheaper**, not ~80% cheaper |
| Haiku $/segment (session 25, N=83, real) | $0.0042 |
| Sonnet vs Haiku | ~9.6× more expensive |
| Projected FULL 83-segment Sonnet gate run | **~$3.35** |

⛔ **Why "a dollar to find out" undersold it.** `claude-sonnet-5` is priced at $2/$10 per MTok
against Opus's $5/$25 — a genuine 2.5× ratio on paper. The real cost came in at only ~1.4× cheaper
than Opus, not 2.5×, meaning Sonnet is generating **proportionally longer output** for this task
than Opus does. That is a real, measured behavioural fact about this specific extraction prompt,
not a pricing error.

⛔⛔ **A container restart mid-run (Railway "sleep when idle" — the same class of incident this
programme has hit before) killed the orchestrating script after round 1 (11 segments, $0.5936)
completed and round 2 (8 segments) was in flight.** Both batches survived on Anthropic's side
regardless (`msgbatch_01Ljxin1KDzHLxzThzoftfPC` ended/succeeded=11,
`msgbatch_01VToAg3KGNVpENbMqZPDLTA` ended/succeeded=8) — no money was lost. **The tracking
DB/ledger was NOT survivable** because this session put them under `/tmp` (ephemeral container
filesystem) instead of `/data/wisdom/scratch/` (the persistent volume) — an operator error,
corrected for any future run. Recovery reconstructed the exact custom_id → segment mapping from
`extract_golden_gate.py`'s own deterministic ordering (`run_batch_round`'s `chunk` indices map
1:1 to `load_gate_segments()`'s sorted output) and re-fetched both batches' real results directly
— no resubmission, no double charge, verified against Anthropic's own batch records before
trusting the numbers.

⚠️ **Quality is UNKNOWN at this sample size and this session stopped rather than guess.** The
per-type table below is informal (N=19, not recorded to `wisdom_eval_runs`, no official gate
decision — `extract_golden_gate.py`'s own `complete()` check requires all 83 segments scored
before it will record anything) and several types have single-digit predicted counts:

| type | tp | fp | fn | precision (n) | recall (n) |
|---|---|---|---|---|---|
| CALL | 3 | 0 | 1 | 1.000 (3) | 0.750 (4) |
| LEVEL | 2 | 2 | 0 | 0.500 (4) | 1.000 (2) |
| MARKET_SIGNAL | 1 | 1 | 0 | 0.500 (2) | 1.000 (1) |
| MENTION | 3 | 0 | 0 | 1.000 (3) | 1.000 (3) |
| NEGATIVE_CALL | 0 | 0 | 0 | — (0) | — (0) |
| PRINCIPLE | 4 | 3 | 0 | 0.571 (7) | 1.000 (4) |

⛔ **N=19 with 0–7 predictions per type cannot answer R101_CLEAR_RULE (±0.05 per type).** A
complete, recordable verdict needs the remaining 64 segments — at the real measured rate that is
**~$2.58 more** (⚠️ not $1.50, and combined with the $0.77 already spent, ~$3.35 total, over the
original $2.00 hard cap). That is a budget decision for the owner, not something this session
decided on its own authority.

## 2. Lexical pre-screen (R102) — real, but ~9%, not 40–60%

**Measured on the full local sample corpus (383 sources, 9,733 segments — the same catalog-batch
segmentation production uses; NOTE this is the OLD 9,733-segment estimate corpus, not the
26,675-segment PRODUCTION corpus session 25 measured — the local sample set was never re-pulled
at the larger size, so treat the *rate* as representative and the *counts* as stale by ~2.7×.)**

| | measured |
|---|---|
| Segments the screen would SKIP (all 7 screens empty) | **8.9%** (869 of 9,733) |
| Segments the screen keeps as CANDIDATE | 91.1% |

Per category (skip %, highest to lowest volume):

| category | candidate | skip | skip % |
|---|---:|---:|---:|
| Live Trading Sessions | 3,112 | 441 | 12.4% |
| The Mental Game | 1,014 | 108 | 9.6% |
| Sunday Scans | 528 | 59 | 10.1% |
| Setups & Strategies | 737 | 62 | 7.8% |
| Interviews | 971 | 70 | 6.7% |
| Risk & Trade Management | 337 | 30 | 8.2% |
| Mindset & Psychology | 136 | 14 | 9.3% |
| Workshops & Fireside Chats | 668 | 36 | 5.1% |
| Market Analysis & Breadth | 308 | 16 | 4.9% |
| Post-Market Recaps | 86 | 4 | 4.4% |
| Scanning & Stock Selection | 257 | 10 | 3.7% |
| Options & Flow | 475 | 17 | 3.5% |
| Sharpen Your Trading Skills | 59 | 1 | 1.7% |
| Thoughts on the Market | 118 | 1 | 0.8% |
| Evening Update | 58 | 0 | 0.0% |

⛔ **Why the drop is small even for Live Trading Sessions, the "mostly narration" category**: the
screen fires on ANY of seven broad signals — a cashtag, an uppercase ticker-shaped token, a
company name, a sector word, a price-shaped number, principle vocabulary ("always", "discipline",
"stop loss"), or signal vocabulary ("distribution day", "risk-off"). Trading-show narration is
FULL of price levels and ticker mentions even in stretches that never construct an extractable
record — the screen is *designed* to be loose (the golden-v1.1 methodology's own words: "the safe
direction for a claim of absence"), and that same looseness is exactly what caps its usefulness
as a cost lever.

**Recall-loss bound, on the golden dev split itself (N=83 segments, real golden labels, R100's
own 15-segment SKIP subset):** every non-null golden record fell inside a segment the screen would
have kept as CANDIDATE — **zero recall loss measured on this split**, for every type including the
floored ones. This is a GOOD result for trustworthiness (the screen is not silently dropping real
records on the one dataset with ground truth) but a small dataset (83 segments, not the full
corpus) — a loss bound of exactly 0% on 83 segments does not prove 0% on 26,675.

**Built, tested, NOT enabled**: `api/services/wisdom/extract/prescreen.py` +
`tools/wisdom/null_screens.py` (the screens themselves, moved out of
`tools/wisdom_golden_verify.py` on the R15 precedent so golden methodology and production share
one definition). `WISDOM_EXTRACT_PRESCREEN_ENABLED` defaults OFF.

## 3. Targeted N (R103) — real, ~21% of N=3 spend, density measured, NOT built

**Measured on gate-run-3's real 3-pass data (83 segments, all 3 passes): 57 of 83 segments
(68.7%) produced at least one floored-type record (CALL/NEGATIVE_CALL/MENTION/PRINCIPLE/
MARKET_SIGNAL) on pass 1 alone — identical to using all 3 passes, because the model's true
positives are stable run to run (session 4's own finding).**

| | measured |
|---|---|
| Segments needing passes 2/3 (produced a floored type on pass 1) | 68.7% |
| Segments that could skip passes 2/3 (MENTION/LEVEL-only or empty) | **31.3%** |
| Spend saved (31.3% of segments skip 2 of 3 passes) | ≈ **20.9%** of total N=3 spend |

⛔ **This session measured the density and did NOT build the production wiring** (R103's own
ruling was `BUILD`, but the density coming in at 31.3% — not the majority the "targeted repass"
framing implied — changes the return on that engineering investment enough that this session held
off pending the owner seeing the number first, rather than building a real pass-scheduling change
into `batch.py`'s N-pass loop on the strength of a name). The semantics, if built: pass 1 over the
pre-screened CANDIDATE set; passes 2/3 submitted on a LATER night only for segments whose pass-1
records include ≥1 floored type; everything else stays at N=1, its MENTION/LEVEL/NEGATIVE_CALL
records publishing unfloored exactly as an N=1 sweep would.

## 4. Output cap + schema trim (R104) — real distribution, savings NOT reliably quantifiable at $0

**Measured from gate-run-3's real persisted usage (249 request-passes, N=83×3):**

    output_tokens distribution: min 28   p50 2,259   p90 10,376   p95 12,222   p99 15,522   max 18,857

| cap (tokens) | requests over cap | kept records "at risk"* | floored kept "at risk"* |
|---:|---:|---:|---:|
| 8,000 | 20.9% | 38.1% | 44.6% |
| 10,000 | 10.4% | 58.2% | 66.5% |
| 12,000 | 6.0% | 76.6% | 78.9% |
| 14,000 | 2.4% | 91.2% | 90.7% |
| 16,000 | 0.8% | 96.8% | 96.6% |

\* **Pessimistic upper bound, explicitly labelled as such**: this treats EVERY kept record in a
request whose real output exceeded the cap as lost outright. Real truncation only loses records
near the END of a response's JSON array, not the whole response — and production already retries
a `max_tokens` stop one effort level lower (`_build_items`'s existing retry logic), so a request
that would hit a lower cap does not simply lose data, it retries shorter. **This session could not
quantify the REAL retained fraction without spending money to re-run at each candidate cap**,
which was out of scope for a $0 step. The pessimistic table above should be read as "how bad it
could be if the retry safety net were not there," not as the expected outcome.

**Practical recommendation, not a measured guarantee:** a cap around **p97–p99 (~14,000–15,500
tokens)** trims the extreme tail (the top ~2–3% of requests, which is where `output_tokens_max
=18,857` lives) with the retry mechanism absorbing the rest, at low risk and modest, unquantified
savings. **Not implemented this session** — R104 changes a request-shape parameter (not the
schema), so `wx-v0-fc47bc97`'s digest is unaffected and no new golden run would be required before
using it, but the real savings figure needs a real (small, cheap) re-run to trust.

**Schema trim (a SEPARATE lever, D2):** not attempted this session — it changes the schema digest,
which mints a new `extractor_version` and requires its own golden run before use (an additional
cost this session did not spend). Deferred.

## 5. Cache audit (R105) — already substantially exploited

Opus's gate-run-3 calibration shows **`cache_read_share: 0.7594`** — 75.94% of input tokens across
the real 83-segment run were served from cache, not billed at full input price. That is already a
large fraction; the system prompt (the dominant fixed cost per request) is being cached
effectively across the batch. **No further cache-side lever identified this session** beyond what
is already happening automatically via the existing `cache_control` wiring.

## 6. The pricing discrepancy (budget.py vs cost_guard.py) — resolved for Wisdom, filed for its owner

Anthropic's own pricing page (fetched 2026-09-18): **Claude Sonnet 5 is $2/$10 per MTok** (Sonnet
4.6 legacy is $3/$15). `api/services/wisdom/extract/budget.py`'s `claude-sonnet-5` row
(**$2.0/$10.0**) is **correct**. `api/services/catalyst/cost_guard.py`'s `claude-sonnet-5` row
(**$3.0/$15.0**) duplicates the 4.6 legacy price onto the 5 key — **wrong, and not fixed here**:
`cost_guard.py` belongs to the catalyst engine, a different subsystem, out of this session's scope.
Filed in `docs/wisdom/HARD-RULES.md`.

## Stacked — what this actually buys, honestly

| configuration | $ for the whole corpus at N=3 (p50 → p90) | vs the original $4,900 estimate |
|---|---|---|
| Opus, no levers (session 25/26's own number) | $3,175 → $4,872 | baseline |
| + prescreen (−8.9% segments) | $2,893 → $4,438 | ~9% down |
| + targeted N (−20.9% of the remaining spend) | $2,288 → $3,510 | ~28% down |
| + output cap (unquantified, plausibly small) | *not stacked — unmeasured* | — |
| **Opus, prescreen + targeted N, no cap** | **~$2,300–3,500** | **~28–30% down** |
| **new sessions only** (nightly incremental, no back catalogue) | **~$5–15/night**, unchanged by any of this — the daily cost was never the corpus problem | — |

**Sonnet does NOT stack with the above as a simple substitution** until its quality is known. If
it clears the gate on a completed run: Opus's $/segment ($0.0574) → Sonnet's ($0.0404) is a
further ~30% off whatever the table above already produced, i.e. roughly **$1,600–2,450** for
prescreen + targeted-N + Sonnet, IF it clears. If it does not clear on all six types, the R97-shape
question resurfaces (tiered / SWEEP_N1_OPUS) exactly as it did for Haiku.

## The opinion, four lines

The cheapest configuration that plausibly still buys the original goal (all six types, gate-cleared
quality) is **Opus + prescreen + targeted N, no output cap yet** — real, measured, low-risk,
~28–30% cheaper than the original estimate. It costs an estimated **$2,300–3,500** for the full
back catalogue at N=3. It takes roughly the same number of nights as the original plan, since the
per-night ceiling is unchanged and coverage-per-night is what shrinks the corpus, not the nightly
rate. **The ruling that starts it:** build R102 and R103 into the production pipeline (currently
built-but-dark for R102, measured-but-unbuilt for R103), arm them, and resume the priority-to-
ceiling sweep under R99's own ordering.

Sonnet remains genuinely promising on cost but **unresolved on quality**, and completing that
answer costs real money beyond what this session was authorized to spend on its own.
