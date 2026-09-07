# Hammer Blind Evaluation Corpus B -- sealed holdout

Built AFTER the ADR-scaling fix (commit 10d7682bc) was frozen, from a fresh
sample disjoint from Corpus A. `fired` means **the fixed detector's firing
candidate is the chart's own last bar** -- not "somewhere in the last 5 bars"
(Corpus A's definition, which produced a large bar-lag artifact; see
diagnose_all.py in this same directory).

- Universe sampled: 900 tickers (seed 202609062) of 4293 total.
- Tickers with >= 320 bars of history: 856.
- (ticker, as_of) windows evaluated: 3355 across offsets (0, 90, 180, 260).
- last-bar-FIRED pool found: 32 (capped at 16, sampled 16).
- NOT-FIRED pool found: 3323 (capped at 16, sampled 16).
- Total corpus size: 32 cases.
- Repo commit at build time: e9330ade6.

**GROUND_TRUTH_STATUS: PENDING** -- this manifest records construction
parameters only. A blind judge with zero access to detector source, fixture
labels, or `answer_key_ingredients.json` must adjudicate `blind_packets.json`
+ the rendered chart PNGs before any unblinding.

Last-bar Hammer firings are a genuinely rare real technical pattern (most
candidates the code considers fail the anatomy or context gate, and most
fired candidates fire on a bar 1-4 sessions in the past relative to a
randomly chosen as-of point) -- the fired-pool size above reflects that
rarity, not a corpus-construction shortfall.
