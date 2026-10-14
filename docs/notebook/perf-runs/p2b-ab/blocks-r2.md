> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\blocks-r2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\blocks-r2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 41.8 ms | 51 ms | < 300 ms | `9156620ce` |
| note_open | 1,000 | 20 | 73.1 ms | 101.2 ms | < 300 ms | `9156620ce` |
| note_open | 2,000 | 20 | 178.5 ms | 207 ms | n/a | `9156620ce` |
| typing_per_char | 1 | 60 | 4.4 ms | 16.9 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 6 ms | 16.5 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 12 ms | 19.5 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.13 ms | 7.22 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 1,000 | 59 | 6.16 ms | 9.38 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 2,000 | 59 | 12.18 ms | 20.68 ms | < 16 ms | `9156620ce` |
