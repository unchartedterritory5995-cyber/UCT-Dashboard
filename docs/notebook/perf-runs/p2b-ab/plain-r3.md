> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\plain-r3.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\plain-r3.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 40 ms | 55.3 ms | < 300 ms | `9156620ce` |
| note_open | 1,000 | 20 | 77.5 ms | 117.8 ms | < 300 ms | `9156620ce` |
| note_open | 2,000 | 20 | 157.6 ms | 175.6 ms | n/a | `9156620ce` |
| typing_per_char | 1 | 60 | 4.9 ms | 15.9 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 8.3 ms | 16.7 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 12 ms | 19.9 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.32 ms | 6.79 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 1,000 | 59 | 9.26 ms | 15.45 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 2,000 | 59 | 10.92 ms | 12.89 ms | < 16 ms | `9156620ce` |
