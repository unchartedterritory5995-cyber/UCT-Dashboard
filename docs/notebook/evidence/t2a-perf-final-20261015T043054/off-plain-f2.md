> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\off-plain-f2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\off-plain-f2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 33.8 ms | 47.4 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 82.4 ms | 100.5 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 147.7 ms | 196.4 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 6.9 ms | 16.8 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 7.5 ms | 17.2 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 10.9 ms | 15.7 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.72 ms | 15.98 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 8.88 ms | 12.35 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 11.83 ms | 21.64 ms | < 16 ms | `c57a084a0` |
