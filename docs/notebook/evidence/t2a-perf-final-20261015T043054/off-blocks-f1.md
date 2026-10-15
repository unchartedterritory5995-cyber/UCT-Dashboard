> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\off-blocks-f1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\off-blocks-f1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 50.2 ms | 70.6 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 95.2 ms | 147.3 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 176.7 ms | 209.5 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 6.5 ms | 17.1 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 8.3 ms | 18.6 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 14.3 ms | 23.1 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.39 ms | 12.8 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 10.39 ms | 19.38 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 13.57 ms | 29.94 ms | < 16 ms | `c57a084a0` |
