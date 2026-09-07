# Bull Flag Corpus B -- structural recognition-quality holdout

Semantic-scale-appropriate two-view rendering (NOT Hammer's candlestick crop):
STRUCTURE view (last 90 bars, with 10/20/50 MAs) for trend/
pole/flag context; DETAIL view (last 45 bars, with MAs, volume) for
close inspection of pole shape, flag channel, depth, and volume contraction.
Both views end at the same `as_of_t` for every case -- the trailing edge of
both charts IS the evaluation point, so no separate candidate marker is
needed (unlike Hammer's single-candle case, a structural pattern's candidate
region is the visible chart itself, uniformly sized across every case
regardless of fired/not-fired state, so the crop cannot leak the detector's
own verdict).

- Universe sampled: 900 tickers of 4293 total (seed 20260906101).
- Tickers scanned: 81. Windows evaluated: 403 across offsets (0, 65, 130, 195, 260).
- FIRED pool found: 60 (sampled 20). NOT-FIRED pool found: 343 (sampled 20).
- Total corpus size: 40 cases.
- Repo commit at build time: 610db4f5e.

**GROUND_TRUTH_STATUS: PENDING** -- a blind judge with zero access to
detector source, `pipeline_trace`, or `detector_fired` must adjudicate
`blind_packets.json` + the rendered charts before any unblinding.

Every case (fired AND not-fired) carries a full gate-by-gate
`pipeline_trace` in `answer_key_ingredients.json` (liquidity -> pivots ->
per-pole-top pole_pct -> pole_bars -> flag_bar_count -> retrace_pct ->
parallel_score -> volume_contracted -> confidence), computed by directly
re-running bull_flag.py's own internal extraction, NOT a reimplementation --
this is what makes root-cause classification of every disagreement
evidence-based rather than guessed.
