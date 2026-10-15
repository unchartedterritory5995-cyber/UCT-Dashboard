> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-plain-q2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-plain-q2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 30.6 ms | 39.9 ms | < 300 ms | `b3fcfb14d` |
| note_open | 1,000 | 20 | 89.7 ms | 107.4 ms | < 300 ms | `b3fcfb14d` |
| note_open | 2,000 | 20 | 157.2 ms | 206.8 ms | n/a | `b3fcfb14d` |
| typing_per_char | 1 | 60 | 3 ms | 16 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 6.2 ms | 14.9 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 10.9 ms | 18.3 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 4.3 ms | 6.22 ms | < 16 ms | `b3fcfb14d` |
| typing_busy_per_char | 1,000 | 59 | 6.26 ms | 9.31 ms | < 16 ms | `b3fcfb14d` |
| typing_busy_per_char | 2,000 | 59 | 11.38 ms | 13.57 ms | < 16 ms | `b3fcfb14d` |
