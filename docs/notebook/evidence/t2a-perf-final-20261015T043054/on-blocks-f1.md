> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-blocks-f1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-blocks-f1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 49.9 ms | 93.9 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 99.4 ms | 132.7 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 178 ms | 208.2 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 5.6 ms | 17 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 9.3 ms | 16.3 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 14.3 ms | 21.8 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 4.74 ms | 9.07 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 8.87 ms | 13.78 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 13.65 ms | 30.09 ms | < 16 ms | `c57a084a0` |
