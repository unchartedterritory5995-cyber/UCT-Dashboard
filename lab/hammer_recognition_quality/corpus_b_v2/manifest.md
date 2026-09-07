# Hammer Corpus B v2 -- render/corpus-integrity fix (same 32 cases)

Re-renders the EXACT SAME 32 (symbol, as_of_t) cases as `corpus_b/`
(the original is preserved untouched) using the two-view harness fix in
`render_v2.py`: a MORPHOLOGY view (last 16 bars, no MAs, wide
per-candle resolution) and a CONTEXT view (last 90 bars, with
10/20/50 MAs, for trend/location judgment) -- both marking the same
candidate (rightmost) bar with an identical neutral gray dashed vertical
line, never encoding pass/fail.

Repo commit at build time: 56c965e5a.

**GROUND_TRUTH_STATUS: PENDING re-adjudication.** A fresh judge with zero
access to detector source, the original Corpus B images/verdicts, or this
corpus's answer key must adjudicate `blind_packets.json` + the rendered
PNGs before any unblinding, exactly like the original pass.

One case (SPRB, case id logged in `data_quality_flags_INTERNAL.json`,
**not surfaced to the judge**) is known from the original label-integrity
review to carry a real bars.db data-quality artifact (an apparent
unadjusted reverse split) that partially corrupts its own context signals
regardless of rendering fix -- kept in the corpus deliberately (to see
whether the new rendering at least lets a judge correctly flag it as
internally inconsistent / AMBIGUOUS-INSUFFICIENT, rather than silently
excluding a known-hard case).
