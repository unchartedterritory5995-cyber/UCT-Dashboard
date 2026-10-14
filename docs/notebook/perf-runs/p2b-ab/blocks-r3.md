> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\blocks-r3.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\blocks-r3.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 35.5 ms | 42.3 ms | < 300 ms | `9156620ce` |
| note_open | 1,000 | 20 | 55.6 ms | 79.4 ms | < 300 ms | `9156620ce` |
| note_open | 2,000 | 20 | 120.8 ms | 169.2 ms | n/a | `9156620ce` |
| typing_per_char | 1 | 60 | 3.5 ms | 14.9 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 5 ms | 16.4 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 9.5 ms | 16.5 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.64 ms | 5.5 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 1,000 | 59 | 6.12 ms | 8.61 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 2,000 | 59 | 10.96 ms | 16.2 ms | < 16 ms | `9156620ce` |
