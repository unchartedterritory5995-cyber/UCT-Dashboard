# Capture queue 2026-11-18: parity unit 1 (`objects`)

Program: `docs/pine/PARITY-ROADMAP-2026-11-18.md` (U-OBJ) and
`docs/pine/evidence/2026-11-18-objects-unit/EVIDENCE.md`. The unit's 45 sole scripts had evidence of every
kind but three: no capture anywhere (roadmap section 7.1, `none`). One batch, for patrick-54, on the
coordinator's convention (NYSE:RDDT 1D + AMEX:SPY 1D, default inputs, from the listing, VALUE captures with the
object x table, `capture-procedure.md`). A reference script's capture stays local (licence-held, LEDGER_ONLY at
promote); the committed one may be committed. Q-OBJ1 is a queue target (`evidence_engine.py queue`); Q-OBJ2 and
Q-OBJ3 are licence-held reference scripts, named by key and source sha as Q-ROB8 / Q-ROB9 are, for the local batch.

| row | script | symbols / timeframe | settles |
|---|---|---|---|
| Q-OBJ1 | `corpus/committed/supertrend-explorer__V4MsmtCeKs.pine` | NYSE:RDDT 1D, AMEX:SPY 1D | Its host drop (`create:label <- pine:request`): the labels its `request.security` values place, and its table. The first grade of either lane. |
| Q-OBJ2 | `reference:custom-screener-with-alerts__dd1bf69eb8` (sha256 `22c82795e7e60b01…`, local sample cache) | NYSE:RDDT 1D, AMEX:SPY 1D | Its host drop (`guard:loop <- pine:collection`): the screener table a loop over an array fills. The first grade of either lane. |
| Q-OBJ3 | `reference:screener-for-40-instruments__a009097811` (sha256 `5d7d7017e421c51f…`, local sample cache) | NYSE:RDDT 1D, AMEX:SPY 1D | Its host drop (`guard:cell <- pine:object-condition`, `loop:empty`): the 40-row table. The first grade of either lane. |

All three need `request-other` admission before the runtime lane can serve them (the probe, evidence section 2):
these captures are their first evidence, not their last wall.
