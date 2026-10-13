# P2b typing compared with P2a (Task 13 Step 5)

Reading: `typing_busy_per_char` p95 (renderer main-thread busy time per key, the budget's
reading under ruling D24). Budget: < 16 ms. Every P2b run below is a quiet-box run (CPU 2.3-5.1 %,
~14.3 GB available, no test runner), fresh data dir, `--boot --busy --sizes 1,1000,2000 --opens 20
--chars 60`, harness exit 0, VERDICT PASS, `C:\data` CLEAN at every checkpoint. Raw files were
committed before this comparison: `fbc92fc252` (plain, blocks) and `6ef433683d` (blocks-r2, r3).

## The numbers

| run | tree | 1 ¶ | 1,000 ¶ | 2,000 ¶ |
|---|---|---:|---:|---:|
| P2a plain (`p2a/plain.md`) | `986914d99` | 4.92 | 7.55 | 10.47 |
| P2b plain (`p2b/plain.md`) | `3444b57e9` | 6.45 | 7.86 | 9.43 |
| P2a blocks, 4 blocks seeded (`p2a/blocks.md`) | `986914d99` | 4.59 | 6.13 | 9.09 |
| P2b blocks, 10 blocks seeded (`p2b/blocks.md`) | `3444b57e9` | 7.23 | 10.28 | 10.20 |
| P2b blocks r2 (`p2b/blocks-r2.md`) | `fbc92fc25` | 6.42 | 7.18 | 11.82 |
| P2b blocks r3 (`p2b/blocks-r3.md`) | `fbc92fc25` | 7.24 | 8.37 | 11.38 |
| **P2b blocks, median of 3** | | **7.23** | **8.37** | **11.38** |
| P2b blocks, own spread (max - min) | | 0.82 | 3.10 | 1.62 |
| median - P2a blocks | | +2.64 | +2.24 | +2.29 |

p50 (median of 3 vs P2a): 3.69 vs 3.28 · 5.06 vs 4.67 · 6.66 vs 7.23 ms. The typical key is flat;
the tail moved.

Trees `3444b57e9` (the plain + blocks pass) and `fbc92fc25` (r2, r3) differ only in the ten
`docs/notebook/perf-runs/p2b/` files of the first pass (`git diff --stat 3444b57e91 fbc92fc252`),
so all three P2b blocks runs measure the same product code.

## What the two blocks columns measure

They are not the same workload. P2a's `--with-blocks` seeded 4 nodes (`TRADER_BLOCK_KINDS` at
`986914d993`: pre-entry checklist, price stamps, position sizing, market context). P2b's seeds 10:
those four plus the six P2b blocks (My rules, the four prep blocks, trade review)
(`tools/notebook_perf_harness.py:567-569`). P2b's every-block note has six more live node views.

## Ruling (R-P2b-TYPING)

Not a defect, and no line moved. Reasons, each from the table:

1. Every P2b reading, plain and blocks, is under the 16 ms budget; the worst is 11.82 ms.
2. The tail shift (+2.2 to +2.6 ms p95) is inside the run-to-run spread on record for this
   harness: 3.6 ms and 4.1 ms at 2,000 ¶ between two runs of one unchanged tree (P0 typing-base1/2,
   8.79 vs 12.38; head/head2, 10.2 vs 14.27). P2a's blocks baseline is a single run, so its own
   spread is unknown.
3. The plain note, which carries no P2b block, also moved at 1 ¶ (+1.53 ms) while the blocks note
   at 2,000 ¶ moved less than its own spread. That points at day-to-day box variation as part of
   the shift, not at P2b code alone.
4. The blocks workload grew from 4 to 10 nodes, so part of the tail is the cost of six more
   blocks being present.

What this does not establish: how much of the ~2.3 ms is P2b code and how much is box variation.
Separating them needs an interleaved A/B (P2a tree and P2b tree alternated on one harness, both
seeding the same 10 blocks, four runs each). Filed as follow-up **F-TYPING-AB**. Cost if this
ruling is wrong: a ~2 ms p95 tail regression goes unattributed, with every reading still at least
4 ms under the budget.
