> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-blocks-q1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-blocks-q1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 44.4 ms | 61.3 ms | < 300 ms | `b3fcfb14d` |
| note_open | 1,000 | 20 | 90.6 ms | 144.5 ms | < 300 ms | `b3fcfb14d` |
| note_open | 2,000 | 20 | 176.2 ms | 197.9 ms | n/a | `b3fcfb14d` |
| typing_per_char | 1 | 60 | 3.5 ms | 16.7 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 7.6 ms | 16.6 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 11.2 ms | 17.8 ms | n/a | `b3fcfb14d` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 4.07 ms | 6.65 ms | < 16 ms | `b3fcfb14d` |
| typing_busy_per_char | 1,000 | 59 | 8.27 ms | 10.22 ms | < 16 ms | `b3fcfb14d` |
| typing_busy_per_char | 2,000 | 59 | 11.67 ms | 13.9 ms | < 16 ms | `b3fcfb14d` |
