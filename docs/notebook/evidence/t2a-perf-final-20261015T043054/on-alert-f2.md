> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-alert-f2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-alert-f2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 33.6 ms | 44.6 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 101.9 ms | 142.6 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 152.7 ms | 195.7 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 6.3 ms | 14.9 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 8 ms | 17.7 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 12.6 ms | 24.2 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.99 ms | 6.37 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 8.83 ms | 14.59 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 12.24 ms | 20.69 ms | < 16 ms | `c57a084a0` |
