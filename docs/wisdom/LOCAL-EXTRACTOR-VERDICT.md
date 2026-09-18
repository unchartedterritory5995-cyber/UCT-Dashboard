---
title: Local extractor verdict — v1 and v2, session 23 (R93)
status: FAIL on R85_CLEAR_RULE (PER_TYPE_WITHIN_005), both versions
---

# The $0 local extractor: what it can and cannot do

Two measurements, same golden bytes (`golden-v1.1`, sha `c26c871ea5a1`, dev split, 83
segments), same scorer (`golden.match_segment`/`golden.score`, never a second one).

## v1 — the shared prompt, unconstrained decoding (session 22, full 83)

`wx-local-qwen2-5-7b-instruct-q4-k-fc47bc97`. Recall 0.00–0.07 on five of six types against
the paid baseline's 0.60–1.00 (gate-run-3, `wx-v0-fc47bc97`, accepted). Root cause: the paid
request carries Anthropic's own schema-constrained generation
(`output_config.format.json_schema`); the local transport sent a plain chat completion with
no such constraint. Dominant rejection: `reject:quote_missing` — the required `quote` field
absent outright, not merely wrong. Separately, 18/83 segments (22%) degenerated into
repetition loops under `temperature=0` greedy decoding.

## v2 — repeat_penalty + schema-constrained decoding + quote-first ordering + explicit
verbatim instruction + 2 few-shot (session 23, R93, 20-segment stratified sample)

`wx-local-v2-qwen2-5-7b-instruct--1bb5d058`. Same 20-segment sample scored on all three of
paid / v1 / v2 for a true like-for-like (paid and v1 sliced from their own persisted runs via
`gate_records.load_phase`, the R12 canonical re-score path).

| type | paid P/R (20-sample) | v1 P/R (20-sample) | v2 P/R (20-sample) |
|---|---|---|---|
| CALL | 0.8889 / 0.8889 | — / 0.0000 | — / 0.0000 |
| LEVEL | 1.0000 / 0.6667 | — / 0.0000 | 0.0000 / 0.0000 |
| MARKET_SIGNAL | 0.5000 / 1.0000 | — / 0.0000 | — / 0.0000 |
| MENTION | 0.2000 / 1.0000 | 0.0000 / 0.0000 | — / 0.0000 |
| NEGATIVE_CALL | 0.6667 / 0.6667 | — / 0.0000 | — / 0.0000 |
| PRINCIPLE | 1.0000 / 1.0000 | — / 0.0000 | 0.0000 / 0.0000 |

**Verdict: FAIL on all six types.** Zero true positives against golden's specific expected
records, on both v1 and v2.

**But the mechanism moved, measurably.** Structural rejection tally on v2's completed
segments (15 of 20; 5 timed out at 480s — a longer prompt from the few-shot turns, unresolved
within Step A's ceiling):

- `reject:quote_missing`: **0** (was the dominant v1 failure — schema-constrained decoding
  eliminated it, confirmed independently on an isolated segment: 3/3 emitted records carried
  a non-empty quote where the v1 baseline had rejected 4/4 for the field being absent)
- `reject:quote_absent`: **24** (new dominant failure — the field is now present but not a
  verbatim substring of the segment text; JSON Schema's `required` can force presence, not
  content correctness)
- 5 records genuinely validated (real quote, real match to text) — none matched a golden
  *specific* expected item on this sample, scored as false positives, not true positives

**Interpretation.** The schema-constraint fix is real and worth keeping (it is now the
backend default, independent of this prompt experiment — see `local_backend.py` R93). It
converts one failure class into a different, more tractable one. It does not, on this
sample, convert into recall against golden's exact expected set at 7B/Q4_K_M. Whether a
larger or less-quantized local model closes the `quote_absent` gap is untested here (see
GPU-search section of the session-23 recon doc).

## Throughput — the second wall

Measured v1 rate (contended box, real session checkpoints): **0.79 segments/min (76s/seg)**.

| N | corpus (26,454 segments) |
|---|---|
| 1 | 23.2 days |
| 3 | 69.6 days |

v2's combined levers (schema constraint + few-shot) measured **slower** per segment (longer
prefill from the few-shot turns), not faster — the quality-adjacent fixes here cost clock,
they do not buy it back.

## Standing rule

No paid extraction client is constructed while `R95_PAID_PATH = HOLD`. This file records a
verdict; it authorizes no spend. A paid path runs only under a named ruling (R95) changed by
the owner, per session-23's brief, Step D.
