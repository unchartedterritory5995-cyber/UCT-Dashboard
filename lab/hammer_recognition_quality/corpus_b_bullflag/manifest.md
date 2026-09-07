# Bull Flag Blind Evaluation Corpus B -- sealed holdout (PREPARED, NOT YET ADJUDICATED)

Fresh sample, disjoint from Corpus A (different seed 202609063 vs. Corpus A's
20260906; different as-of offsets (0, 75, 150, 225, 300) vs. Corpus A's (0, 130);
wider universe sample 400 vs. Corpus A's 260).

Bull Flag was NOT modified in this pass (owner priority: Hammer). This
corpus is prepared and preserved for a future improvement cycle -- the same
development/holdout protocol Hammer just went through, starting from
Corpus A's already-known failure modes (weak pole-verification, loose
pullback-depth/duration thresholds, a likely non-volatility-scaled
threshold; see lab/quality/blind_corpus/bull_flag/UNBLINDED_RESULTS.md on
the pattern-intelligence-lab branch).

- Universe sampled: 400 tickers of 4293 total.
- Tickers with >= 320 bars: 78.
- Windows evaluated: 380 across offsets (0, 75, 150, 225, 300).
- FIRED pool found: 48 (sampled 16). NOT-FIRED pool found: 332 (sampled 16).
- Total corpus size: 32 cases.
- Repo commit at build time: e9330ade6.

**GROUND_TRUTH_STATUS: PENDING.** Not yet adjudicated in this pass. `fired`
here means "detect_bull_flag() returned >=1 Detection anywhere in the
window" (same semantics as Corpus A) -- bull_flag.py scans pole-top pivots
across the whole window rather than only the last few bars (unlike
Hammer's pre-fix `_SCAN_LOOKBACK=5`), so the specific bar-lag artifact that
affected Hammer's raw precision number does not obviously apply here in the
same form; this has NOT been independently verified and is flagged as an
open question for whoever picks up Bull Flag next.
