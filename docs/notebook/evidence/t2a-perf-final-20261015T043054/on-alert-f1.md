> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-alert-f1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-alert-f1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 31 ms | 42.7 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 87.9 ms | 175.5 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 151.7 ms | 201.9 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 6.3 ms | 16.1 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 10.1 ms | 19.2 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 13.3 ms | 27.3 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.76 ms | 5.17 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 7.39 ms | 11.93 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 11.92 ms | 18.11 ms | < 16 ms | `c57a084a0` |
