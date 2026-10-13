> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-p2\docs\notebook\perf-runs\p2a\blocks.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-p2\docs\notebook\perf-runs\p2a\blocks.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 31.2 ms | 38.6 ms | < 300 ms | `986914d99` |
| note_open | 1,000 | 20 | 50.7 ms | 60.7 ms | < 300 ms | `986914d99` |
| note_open | 2,000 | 20 | 81.2 ms | 104.5 ms | n/a | `986914d99` |
| typing_per_char | 1 | 60 | 3.2 ms | 15.2 ms | n/a | `986914d99` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 4.4 ms | 16.5 ms | n/a | `986914d99` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 8.1 ms | 16.3 ms | n/a | `986914d99` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.28 ms | 4.59 ms | < 16 ms | `986914d99` |
| typing_busy_per_char | 1,000 | 59 | 4.67 ms | 6.13 ms | < 16 ms | `986914d99` |
| typing_busy_per_char | 2,000 | 59 | 7.23 ms | 9.09 ms | < 16 ms | `986914d99` |
