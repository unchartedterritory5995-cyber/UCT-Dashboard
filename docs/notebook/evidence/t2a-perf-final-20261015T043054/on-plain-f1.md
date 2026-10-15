> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-plain-f1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\on-plain-f1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 46.7 ms | 79.2 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 86 ms | 148.1 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 146.4 ms | 180.4 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 4.7 ms | 16.2 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 10.5 ms | 19.6 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 12.1 ms | 22.7 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 4.8 ms | 8.73 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 8.59 ms | 12.84 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 11.63 ms | 16.03 ms | < 16 ms | `c57a084a0` |
