> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-p2\docs\notebook\perf-runs\p2a\plain.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-p2\docs\notebook\perf-runs\p2a\plain.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 22.7 ms | 27.6 ms | < 300 ms | `986914d99` |
| note_open | 1,000 | 20 | 43.3 ms | 48 ms | < 300 ms | `986914d99` |
| note_open | 2,000 | 20 | 65.2 ms | 81.6 ms | n/a | `986914d99` |
| typing_per_char | 1 | 60 | 3.1 ms | 15 ms | n/a | `986914d99` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 4.4 ms | 15.7 ms | n/a | `986914d99` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 6.4 ms | 16.5 ms | n/a | `986914d99` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.07 ms | 4.92 ms | < 16 ms | `986914d99` |
| typing_busy_per_char | 1,000 | 59 | 4.81 ms | 7.55 ms | < 16 ms | `986914d99` |
| typing_busy_per_char | 2,000 | 59 | 7.03 ms | 10.47 ms | < 16 ms | `986914d99` |
