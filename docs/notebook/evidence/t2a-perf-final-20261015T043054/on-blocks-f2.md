> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-blocks-f2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-blocks-f2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 51.6 ms | 89.8 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 103.1 ms | 178.3 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 184.6 ms | 246 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 6.7 ms | 15.3 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 11.2 ms | 19.4 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 11.5 ms | 20.6 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 4.15 ms | 6.44 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 8.46 ms | 10.36 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 12.55 ms | 17.29 ms | < 16 ms | `c57a084a0` |
