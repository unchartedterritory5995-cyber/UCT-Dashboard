> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-alert-q1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-alert-q1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 28.5 ms | 34.2 ms | < 300 ms | `b3fcfb14d` |
| note_open | 1,000 | 20 | 56.5 ms | 74.8 ms | < 300 ms | `b3fcfb14d` |
| note_open | 2,000 | 20 | 149.9 ms | 182.6 ms | n/a | `b3fcfb14d` |
| typing_per_char | 1 | 60 | 2.8 ms | 14.3 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 7.7 ms | 16.3 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 11.3 ms | 18.7 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.59 ms | 5.1 ms | < 16 ms | `b3fcfb14d` |
| typing_busy_per_char | 1,000 | 59 | 6.38 ms | 9.45 ms | < 16 ms | `b3fcfb14d` |
| typing_busy_per_char | 2,000 | 59 | 11.89 ms | 14.61 ms | < 16 ms | `b3fcfb14d` |
