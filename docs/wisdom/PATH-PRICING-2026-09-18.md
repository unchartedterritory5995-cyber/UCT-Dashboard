---
title: Every real extraction path, priced — session 23, R96
ruling: R95_PAID_PATH = HOLD. Nothing here spends. A path runs only when R95 is changed.
---

# Data source and a blocker, stated up front

No Anthropic API key was reachable this session (not in the shell env, not in a local
`.env`, not in the OS keyring service `uct-wisdom`/`anthropic`) — so `count_tokens`, the one
paid-API call this session's ruling permitted, could not be made. Rather than estimate from
character counts, this table uses **real, already-paid-for Anthropic usage** persisted from
gate-run-3's own API calls (`data/wisdom/gate-runs/20260915T123550Z/segments.jsonl`, 83
real production-sourced segments, `usage.input_tokens` / `usage.cache_read_input_tokens` /
`usage.output_tokens` from the actual responses). This is stronger than a character estimate
would have been; it is not a fresh 500-segment production sample as R96 asked for, and that
gap should close before any path here is treated as final.

**Prices** (per Mtok, batch = 0.5×, cache read = 0.1× input): Opus 5 $5/$25
(`budget.py:PRICES_PER_MTOK`), Sonnet 5 $2/$10 (same), Haiku 4.5 $1/$5
(`api/services/catalyst/cost_guard.py` — budget.py carries no Haiku entry).

**Per-segment cost (batch, measured distribution):**

| model | p50 | p90 |
|---|---|---|
| Opus 5 | $0.02908 | $0.13436 |
| Sonnet 5 | $0.01163 | $0.05374 |
| Haiku 4.5 | $0.00582 | $0.02687 |

**Density proxy**: 18 of 83 dev segments (21.7%) carry a PRINCIPLE or MARKET_SIGNAL golden
record. Night 1 never ran, so this is the *only* measured proxy for the real corpus — stated,
not hidden.

# The table

| path | $ p50 | $ p90 | clock | delivers | basis |
|---|---|---|---|---|---|
| (v) LOCAL | **$0** | $0 | 23.2d N=1 / 69.6d N=3 | nothing clears — FAILS R85 on all 6 types | **measured** (session 23, 20-seg sample) |
| (iv) HAIKU_ONLY N=3 | $462 | $2,133 | hours (batch) | all 6 types, quality **unmeasured** vs golden | priced; quality untested |
| (iii) TIERED_HAIKU_OPUS | $962 | $4,445 | hours (batch) | mechanical at Haiku, judgement at Opus (proxy density) | priced; Haiku quality untested |
| (ii) SWEEP_N1_OPUS + targeted repass | $1,103 | $5,096 | hours (batch) | all 6 types at Opus quality, N=3 on judgement | priced from measured distribution |
| (i) SWEEP_N1_OPUS alone | $769 | $3,554 | hours (batch) | all 6 types once — judgement PENDING until a repass | priced |
| (vi) LOCAL mech. + OPUS judgement | *n/a* | *n/a* | *n/a* | **NOT ACTIONABLE** — local cleared zero types | hypothetical only |

**Settling measurement**: an 83-segment Haiku golden run (same shape as gate-run-3) —
**$0.48–$2.23**. This is what would turn "(iii)/(iv)'s quality unmeasured" into a real number,
at a cost close to free.

# Opinion, three lines

**(ii) buys the stated goal — judgement types at trusted (Opus) quality, mechanical types
floor-scored, everything scored in one programme — for $1,103–$5,096, not the $462–$2,133 of
(iv), because (iv)'s cheapness is priced against an UNMEASURED Haiku quality claim.** The
single cheapest measurement that would change this answer is the $0.48–$2.23 Haiku golden
run: if Haiku clears the mechanical types at anywhere near Opus's accepted numbers, (iii)
becomes the better trade at roughly a fifth the cost of (ii); if it doesn't, (ii) stands as
priced. Local (v) is not a contender at any density — it is $0 and it does not clear.

# What this table is not

Not a spend. `R95_PAID_PATH = HOLD` in the session-23 brief; no messages/batches call was
made to reach these numbers, only a read of an already-persisted artifact. A path here runs
only when the owner changes that ruling.
