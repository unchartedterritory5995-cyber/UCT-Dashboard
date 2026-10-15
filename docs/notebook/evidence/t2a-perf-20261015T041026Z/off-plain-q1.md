> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-plain-q1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-plain-q1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 28.9 ms | 37.9 ms | < 300 ms | `b3fcfb14d` |
| note_open | 1,000 | 20 | 69.8 ms | 121.9 ms | < 300 ms | `b3fcfb14d` |
| note_open | 2,000 | 20 | 114 ms | 154.9 ms | n/a | `b3fcfb14d` |
| typing_per_char | 1 | 60 | 2.7 ms | 14 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 5.4 ms | 16 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 11.4 ms | 18.9 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.44 ms | 5.16 ms | < 16 ms | `b3fcfb14d` |
| typing_busy_per_char | 1,000 | 59 | 7.45 ms | 9.71 ms | < 16 ms | `b3fcfb14d` |
| typing_busy_per_char | 2,000 | 59 | 11.26 ms | 14.66 ms | < 16 ms | `b3fcfb14d` |
