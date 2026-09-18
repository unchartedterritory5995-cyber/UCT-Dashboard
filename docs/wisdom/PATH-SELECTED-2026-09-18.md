---
title: Path selected by rule — R97 Haiku golden run, session 25
status: SWEEP_N1_OPUS selected. NOT YET ARMED — see the note at the end.
---

# R97 — the Haiku golden run, real numbers

Real, in-container run against production's own key, `--max-usd 3.0` hard cap, on the
identical 83-segment dev split (`golden-v1.1`, sha `c26c871ea5a1`) every prior measurement
in this programme has used. Zero errors, 83/83 segments scored. **Real spend: $0.3469**
(against the $2.23 estimate and the $3.00 hard stop — Haiku's real cost per segment was
roughly 6x cheaper than the estimate assumed).

One structural fix was required and landed before this run could measure anything: Haiku
4.5 rejects `output_config.effort` outright (`"This model does not support the effort
parameter"`) — the first attempt's 35-request batch came back 35/35 errored, $0 spent, no
measurement. Fixed by omitting `effort` for models in an explicit, evidence-only allowlist
(`prompt.NO_EFFORT_MODELS`), never guessed forward to other models. Opus's request shape,
and its pinned `extractor_version`, are both verified byte-for-byte unchanged.

| type | Opus P (gate-run-3) | Haiku P | ΔP | Opus R | Haiku R | ΔR | clears (±0.05) |
|---|---|---|---|---|---|---|---|
| CALL | 0.6538 | 0.4210 | −0.2328 | 0.7391 | 0.3480 | −0.3911 | NO |
| LEVEL | 1.0000 | 0.8750 | −0.1250 | 0.6000 | 0.7000 | +0.1000 | NO |
| MARKET_SIGNAL | 0.6000 | — | — | 1.0000 | 0.0000 | −1.0000 | NO |
| MENTION | 0.8793 | 0.2000 | −0.6793 | 1.0000 | 0.0590 | −0.9410 | NO |
| NEGATIVE_CALL | 0.8333 | 1.0000 | +0.1667 | 0.8333 | 0.3330 | −0.5003 | NO |
| PRINCIPLE | 0.6842 | 0.9170 | +0.2328 | 0.8667 | 0.7330 | −0.1337 | NO |

**Zero of six types clear R97_CLEAR_RULE (PER_TYPE_WITHIN_005).**

**The shape is worth naming, not just the verdict.** Haiku is not uniformly bad — on
PRINCIPLE and NEGATIVE_CALL its precision genuinely *exceeds* Opus's (0.917 vs 0.684; 1.000
vs 0.833): it is conservative, emitting fewer false positives, at the cost of missing real
ones (recall −0.13 to −0.50). On MENTION and CALL it fails on both axes at once — this is
where it is least trustworthy. MARKET_SIGNAL: zero true positives at all on this split.

Full recovery/incident note: the original submission's batch was orphaned when an ssh
disconnect killed the local polling process mid-flight (batches are async on Anthropic's
side and outlive the connection that submitted them — confirmed no real cost was ever at
risk: an errored batch item is not billed, and the $0 recorded matched that directly). The
working run above is a clean, independent resubmission after the effort-fix landed.

# Step C — path selection, applied mechanically

> M = CALL, MENTION, LEVEL, NEGATIVE_CALL (mechanical). J = PRINCIPLE, MARKET_SIGNAL (judgement).
> - Haiku clears ALL six → HAIKU_ONLY
> - Haiku clears all of M but not all of J → TIERED
> - **Haiku clears fewer than all of M → SWEEP_N1_OPUS**

Haiku clears **zero** of the four mechanical types (CALL and MENTION fail badly on both
axes; LEVEL and NEGATIVE_CALL each fail on one axis by more than the 0.05 tolerance). The
rule's third branch applies without ambiguity.

**Selected path: SWEEP_N1_OPUS.** Every segment once at Opus, all six types produced,
judgement-bearing segments PENDING until a targeted repass. Priced in
`docs/wisdom/PATH-PRICING-2026-09-18.md`: **$769 p50 / $3,554 p90** for the base sweep alone
(from real, measured per-segment usage — gate-run-3's own persisted API responses, not an
estimate), with the 2-pass targeted repass on the measured 21.7% PRINCIPLE/MARKET_SIGNAL
density adding roughly another $334–$1,542, for a combined $1,103–$5,096.

# What this document does NOT do

**This records the selection. It does not arm it.** Running SWEEP_N1_OPUS requires, per
this session's own ruling (R79_PENDING_NOT_QUEUED: BUILD_BEFORE_SWEEP): building R79
(pending ≠ queued) first — a real feature this session has no prior specification for
beyond its name and requirement, not something to design and land under the same
one-line-fix-and-verify discipline that carried R80/R98/the effort-omission fix. It then
means writing R59's budget values to PRODUCTION's live environment
(`WISDOM_EXTRACT_ENABLED=1`, the model/target, the $1,800 programme ceiling) and letting
the scheduled chain spend against them autonomously, across multiple real nights, on the
service that also serves live members — a materially larger and longer-running commitment
than the single $3-capped, fully-supervised measurement this document reports.

Given that gap in specification and that jump in scale and duration, this stops here for
the owner's decision, with the real numbers in hand rather than the estimated ones.
