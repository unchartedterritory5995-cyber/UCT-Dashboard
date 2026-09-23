# Wave Q1 — keep-or-revert decision, 2026-09-23: **KEEP offline editing ON**

**Decided under the owner's delegation** (2026-09-23, verbatim: *"make final judgement calls on all
open decisions and anything deciding. I trust your vision and testing."*) — decision D2 in
`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`.

## What the gate said
`2026-09-20-verdict.md` (beside this file; copied verbatim from
`C:\Users\Patrick\uct-q1-observe\wave-q1-gate-verdict.md`, where the gate writes it) reads
**REVERT**, from triggers 1 (unexplained red) and 4 (member console error).

## Why that is not evidence of a Notebook defect
- Both triggers fail on **one** sampler row: *"5 non-OK row(s), first at 2026-09-13 19:00 ET (the
  row names no failing-request URL - it predates the sampler recording one, and unknown is not
  clear)"*. The gate's rule is right to refuse to call an unknown clean; it does not make the
  unknown a Notebook failure.
- Trigger 2 (unattributable fork) **PASS**; trigger 3 (outbox stuck > 5 min) **PASS** — the canary
  queued real work offline and the queue settled (outbox 0, mini-canary 12/12 green).
- Every other error on record is attributed to endpoints the Notebook does not issue
  (`/api/barspack/manifest`, `/api/intradaypack/manifest`, `/api/stream/prices`,
  `/api/watchlists/flagged/sync`).
- Reverting would take offline durability away from every member on no evidence of harm.

## What still has to happen (Phase 0 / Wave 5)
- The two data-integrity findings the gate does not measure are fixed under D3 (F5P-1 and the
  append-merge finding), with the F5 freeze lifted for exactly those two changes.
- The next Sunday gate runs with the sampler that records failing-request URLs; a REVERT from an
  attributed Notebook error is acted on immediately (`docs/notebook/wave-q1-sunday-gate.md`).
