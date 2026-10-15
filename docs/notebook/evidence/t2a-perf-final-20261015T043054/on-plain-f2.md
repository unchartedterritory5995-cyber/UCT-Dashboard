> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-plain-f2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-plain-f2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 33 ms | 49.3 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 97.2 ms | 149.1 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 154.9 ms | 202.2 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 4.6 ms | 16.9 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 9.6 ms | 19 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 12.6 ms | 22.9 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.91 ms | 5.54 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 8.38 ms | 12.94 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 12.2 ms | 17.46 ms | < 16 ms | `c57a084a0` |
