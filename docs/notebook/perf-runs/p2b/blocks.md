> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-p2b\docs\notebook\perf-runs\p2b\blocks.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-p2b\docs\notebook\perf-runs\p2b\blocks.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 29.7 ms | 35.6 ms | < 300 ms | `3444b57e9` |
| note_open | 1,000 | 20 | 52.1 ms | 62.2 ms | < 300 ms | `3444b57e9` |
| note_open | 2,000 | 20 | 84.3 ms | 99 ms | n/a | `3444b57e9` |
| typing_per_char | 1 | 60 | 3.3 ms | 14.3 ms | n/a | `3444b57e9` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 5.3 ms | 15.4 ms | n/a | `3444b57e9` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 6.4 ms | 16.4 ms | n/a | `3444b57e9` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.65 ms | 7.23 ms | < 16 ms | `3444b57e9` |
| typing_busy_per_char | 1,000 | 59 | 5.07 ms | 10.28 ms | < 16 ms | `3444b57e9` |
| typing_busy_per_char | 2,000 | 59 | 6.55 ms | 10.2 ms | < 16 ms | `3444b57e9` |
