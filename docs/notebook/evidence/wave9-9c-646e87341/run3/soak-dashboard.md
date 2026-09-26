# Notebook 30-day soak — dashboard

VERDICT: **INCONCLUSIVE**

- generated: 2026-09-26 04:35 UTC
- window: 2026-09-26 04:31 UTC → 2026-10-26 04:31 UTC (30 days + 0.0 unobserved) · production SHA at start: `646e87341`
- days observed: 0.0 · unobserved: 0.0 · elapsed: 0.0
- observation rows: 1 · soak reads: 1
- alerts: desktop only — SUPPRESSED this run

## Why this is not a PASS

- exposure floor: 1 organic identities of 5 (exact, from the soak's first minute)
- exposure floor: 8 organic note-edit-days of 100
- exposure floor: 1 active days of 20
- 2 fork(s) on 2026-09-26 not attributed (add `- FORK 2026-09-26: ATTRIBUTED — why`)
- window open: 30.0 day(s) to go (ends 2026-10-26 04:31 UTC)

## Exposure floor (D-9C1)

| measure | now | floor |
|---|---|---|
| organic identities | 1 | 5 |
| organic note-edit-days | 8 | 100 |
| active days | 1 | 20 |

Identities: exact, from the soak's first minute. A day's note edits are the largest figure any two-hour read reported for it (`j2_notes.updated_at` keeps only a note's last edit, so each read is a lower bound).

## Integrity signals, by population

| signal | organic | synthetic | rig/owner | unknown internal | unresolved |
|---|---|---|---|---|---|
| conflict_forked events | 2 | 0 | 0 | 0 | 0 |
| offline-layer conflicted copies | 2 | 0 | 0 | 0 | 0 |
| connector conflicted copies (lower bound) | 0 | 0 | 0 | 0 | 0 |
| blocked-baseline events | 2 | 0 | 0 | 0 | 0 |
| Notebook-page client errors | 2 | 0 | 0 | 0 | 0 |
| save_failed (all reasons) | 2 | 2 | 0 | 0 | 0 |

Anonymous Notebook-page client errors: 0. Mini-canary runs in the window: 0.

Forks by ET day (the larger of organic conflict events and offline copies — one fork writes both — plus trigger-2 rises): 2026-09-26: 2

## Config served (latest read, by identity)

organic 0/0 · synthetic 0/0 · rig_owner 0/0 · unknown_internal 0/0 · unresolved 0/0

## Field speed — field: network + device (reported, never paged)

Basis: whole soak (cumulative read).

| event | n | p50 ms | p95 ms | budget p95 ms | |
|---|---|---|---|---|---|
| note_open_ms | 7 | 226 | 272.5 | 300 |  |
| search_used | 1 | 64 | 64 | 100 |  |
| ask_used | 1 | 910 | 910 | no budget set |  |

## Sunday verdicts

none due yet

## Restore drills (one PASS per 7-day block)

no full week elapsed yet

## Incidents

none filed

## Unobserved intervals (each extends the window)

none

## Heartbeats

- scheduled task: not checked
- rig sign-in: no standing SIGN-IN REQUIRED row
- admin read (C5): OK at 2026-09-26 04:35 UTC

## Running copies vs the repo

- equal `nb_observe.py` — copy `055b795f0f71` · repo `055b795f0f71`
- equal `nb_gate.py` — copy `a843e4f37c27` · repo `a843e4f37c27`
- equal `window_check.py` — copy `76c0a9a5cb7f` · repo `76c0a9a5cb7f`
- equal `nb_soak.py` — copy `965681e6257d` · repo `965681e6257d`
