# Pullback-to-21-EMA (Minervini SEPA) Corpus B -- family #3 first evaluation

Real-world, blinded recognition-quality corpus for `pullback_to_21ema.py`
(a real, production-registered detector -- verified reachable via
`api/routers/patterns.py`'s explicit import). Same certified two-view,
gate-traced methodology as the Hammer/Bull Flag programs
(render_ma.py: structure 130 bars + SMA50/SMA200/EMA21;
detail 35 bars + EMA21 + volume; trace.py: full gate-by-gate
re-derivation of the detector's own logic).

- Universe sampled: 1400 tickers of 4293 total.
- Tickers scanned: 502. Windows evaluated: 3465.
- FIRED pool found: 60 (sampled 20). NOT-FIRED pool found: 3405 (sampled 20).
- Total corpus size: 40 cases.
- Repo commit at build time: 58a3c1f21.

**GROUND_TRUTH_STATUS: PENDING** -- a blind judge with zero access to
detector source, `pipeline_trace`, or `detector_fired` must adjudicate
before any unblinding.
