# D22 scale curve on a quiet box (`curve-d22-q2`): reading

The raw files are committed first (`678a5392ea`, R-RAW): `curve-d22-q2.json`, `curve-d22-q2.log`,
`curve-d22-q2-box.txt`. This file only interprets them.

## Was the box quiet?

Yes, at both ends (`curve-d22-q2-box.txt`):

- before, 2026-10-02T10:47:52Z: lock FREE, load QUIET (0 marked processes outside our own tree)
- after, 2026-10-02T10:50:09Z, rc=0: lock FREE, load QUIET

So this reading does not carry the loaded-box caveat the earlier wave-10 curve runs carry.

## Verdict

From the last line of `curve-d22-q2.log`:

> VERDICT: PASS -- curve: every op's slope <= 1.1 (connection=per-call); diagnostic shared: 5 breach(es) recorded, not gating

The gating model is per-call (D22 clause 14d, controller, owner-delegated 2026-09-30; log line 12).
Under it, every op's log-log slope of p50 over 1,000 / 5,000 / 10,000 / 25,000 / 50,000 notes is at
or under 1.1, and every last segment is at or under 1.3 (log lines 154-177). The steepest are
`tag_counts` 0.812, `tag_tree` 0.822, `GET /notes/tags` 0.812 and `list_tasks` 0.787 (last segment
1.006).

## The shared-model diagnostic (recorded, not gating)

The same run also measures with one shared connection. Five breaches are recorded there (log lines
179-203):

| op | breach | p50 ms at 1k / 5k / 10k / 25k / 50k |
|---|---|---|
| `count_notes` (whole library) | slope 1.119 > 1.1 | 0.04 / 0.14 / 0.27 / 0.66 / 3.79 |
| `count_notes` (whole library) | last segment 25k->50k 2.531 > 1.3 | 0.66 -> 3.79 |
| `folder_note_counts` (whole library) | last segment 25k->50k 2.024 > 1.3 | 1.32 -> 5.39 |
| `get_symbol_backlinks` | slope 1.121 > 1.1 | 0.17 / 0.77 / 1.5 / 6.31 / 13.08 |
| `list_tasks` (open, `?view=tasks`) | slope 1.159 > 1.1 | 0.46 / 2.81 / 7.72 / 19.56 / 40.64 |

These do not change the verdict. By the D22 ruling the shared model is diagnostic only. The absolute
times are small: the worst 50k p50 is `list_tasks` at 40.64 ms. The two last-segment breaches are
sub-6 ms values, where one step of noise moves the ratio a lot.

## What this settles, and what it does not

- Clause 14d (the curve) is met on a quiet box under the gating model.
- It does not explain the shared-model super-linearity of `list_tasks` and `get_symbol_backlinks`.
  Whether the earlier loaded-box diagnostics show the same two ops was not compared here. That is a
  candidate for later work, not a gate failure.
