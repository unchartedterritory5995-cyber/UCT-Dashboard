> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\blocks-r1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-typing-ab\docs\notebook\perf-runs\p2b-ab\blocks-r1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 41.8 ms | 62.3 ms | < 300 ms | `9156620ce` |
| note_open | 1,000 | 20 | 63.6 ms | 85 ms | < 300 ms | `9156620ce` |
| note_open | 2,000 | 20 | 99.8 ms | 191.4 ms | n/a | `9156620ce` |
| typing_per_char | 1,000 | 60 | 5.8 ms | 15.9 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 12.1 ms | 18.6 ms | n/a | `9156620ce` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.12 ms | 8.06 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 1,000 | 59 | 6.83 ms | 12.76 ms | < 16 ms | `9156620ce` |
| typing_busy_per_char | 2,000 | 59 | 11.54 ms | 14.74 ms | < 16 ms | `9156620ce` |
| INCONCLUSIVE | | | | | | typing (wall-clock) at 1 paragraphs: 59 samples for 60 keys sent |
