# Lane PC: the scale curve (clause 14d). Readings and what they mean

The raw files in this directory were committed before this README, in 765252933, 3309d7e08, 848144264 and 0e933480d.
The lane subagent stopped at the account's usage limit after its after-runs. The controller committed those runs as they stood and wrote this README.

## What the breach is

`tools/notebook_scale_benchmark.py --curve` fits a log-log slope of p50 over 1k/5k/10k/25k/50k notes. Its bounds: the fit <= 1.1 and the last segment <= 1.3.

**The benchmark's model:** it holds ONE long-lived SQLite connection with SQLite's default page cache (2 MB) against a ~490 MB database at 50k notes.

**The diagnosis** (`diag-before-slopes.txt`, `diag_curve.py`) runs the same ops under four connection settings:

| op | bench (default cache): fit / last | cache 64 MB | mmap 512 MB | per-call connection |
|---|---|---|---|---|
| count_notes (whole library) | 1.26 / **3.02** | 0.93 / 0.69 | 0.83 / 1.03 | 0.32 / 0.51 |
| folder_note_counts | 1.12 / **2.29** | 1.03 / 0.61 | 0.94 / 1.04 | 0.34 / 0.49 |
| get_symbol_backlinks | **1.15** / 1.07 | 1.10 / 0.81 | 1.05 / 0.85 | 0.65 / 0.70 |

With a page cache sized for the database, or with mmap, every op is linear or better. The super-linear shape is SQLite's 2 MB page cache spilling. It is not an algorithm.

**Production does not use the benchmark's model.** `api/services/auth_db.get_connection` opens a FRESH connection on every call. It sets only `journal_mode=WAL` and `foreign_keys=ON`: no pool and no cache_size. That is the "per-call" column: fit 0.32-0.65, sub-linear, because the per-open cost dominates.

## What changed in the product

`dfadfcd57`: `get_symbol_backlinks` answers in ONE pass over the symbol's notes. Before, it counted in a second pass.
- A/B (`diag-ab.*`): about 2x faster at every tier, with the same answer on every row. For example, at 50k with the bench cache: 26-38 ms -> 13-16 ms.
- Rails: `tests/test_journal_two_backlinks_one_pass.py` and `test_journal_two_notes_read_plans.py`.
- Mutations (`mutation-backlinks*.txt`): M1, M2, M4 and M5 are red. M6 is red after `96b07aa38`'s KEYED rail.
- **M3 survives.** The new `ORDER BY n.updated_at DESC, n.id` tiebreak has no test with equal `updated_at`. The gap is recorded; the order is deterministic, but it is unrailed.

**Rejected:** a covering index for the tasks list. It kept the same answers and was **5-7x slower** (for example, 64 ms -> 351 ms at 25k). It was not committed to the product.

## Verdict for 14d: NOT MET, and a ruling is needed

- The bench-model curve still breaches after the change (`curve-after-1/2.*`; curve-after-2 had 0 foreign processes at its start and end).
- Under production's own connection model, the diagnosis shows no super-linear op.

Changing the instrument's connection model would change what the clause measures. That is a ruling for the owner, and it has NOT been taken here. The bounds in `perf-budgets.json` are unchanged.

Proposed ruling: the curve runs in the per-call model production uses, with the bench-model curve kept as a diagnostic.
Alternative: set a production `cache_size` / `mmap_size` on the notes connection. That is a product change on the universal auth.db request path, and needs its own measurement of memory per connection.

## Command 1 after the change

`cmd1-after.*`, 08:27 CT, market hours; load was sampled only at the start and end (cpu 13-20, 0 foreign test processes):
- `GET /notes q=common, relevance` p95 was **142.5 ms** (re-measured 144.4), against the 100 ms budget. Every other op passed.
- The controller's 07:04 CT quiet run of the SAME tree (2fb102c74) read **71.98 ms** for that op. Its load was sampled every 20 s with 0 foreign processes throughout.
- `dfadfcd57` does not touch the relevance path.

The two readings differ by 2x on unchanged code. So this op's p95 at 50k is load-sensitive near its budget, and one quiet PASS should not be read as margin.
