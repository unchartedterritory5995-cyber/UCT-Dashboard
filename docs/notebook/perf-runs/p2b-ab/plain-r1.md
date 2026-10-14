> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\plain-r1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\plain-r1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 27 ms | 30.6 ms | < 300 ms | `9156620ce` |
| note_open | 1,000 | 20 | 55.2 ms | 97.8 ms | < 300 ms | `9156620ce` |
| note_open | 2,000 | 20 | 138.7 ms | 161.9 ms | n/a | `9156620ce` |
| typing_per_char | 1 | 60 | 4 ms | 15.9 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 6.7 ms | 16 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 10.3 ms | 17 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.85 ms | 6.27 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 1,000 | 59 | 5.78 ms | 8.14 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 2,000 | 59 | 11.51 ms | 15.78 ms | < 16 ms | `9156620ce` |
