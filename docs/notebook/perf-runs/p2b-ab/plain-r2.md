> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\plain-r2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\plain-r2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 29.4 ms | 36.3 ms | < 300 ms | `9156620ce` |
| note_open | 1,000 | 20 | 71 ms | 119.6 ms | < 300 ms | `9156620ce` |
| note_open | 2,000 | 20 | 118 ms | 164.6 ms | n/a | `9156620ce` |
| typing_per_char | 1 | 60 | 3.1 ms | 15.6 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 5.7 ms | 16.9 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 10.6 ms | 16.2 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.53 ms | 5.17 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 1,000 | 59 | 6.87 ms | 10.57 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 2,000 | 59 | 12.43 ms | 19.83 ms | < 16 ms | `9156620ce` |
