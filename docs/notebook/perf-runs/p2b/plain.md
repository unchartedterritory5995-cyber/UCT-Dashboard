> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-p2b\docs\notebook\perf-runs\p2b\plain.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-p2b\docs\notebook\perf-runs\p2b\plain.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 21.8 ms | 28.2 ms | < 300 ms | `3444b57e9` |
| note_open | 1,000 | 20 | 41.8 ms | 48.6 ms | < 300 ms | `3444b57e9` |
| note_open | 2,000 | 20 | 67.4 ms | 80.3 ms | n/a | `3444b57e9` |
| typing_per_char | 1 | 60 | 2.8 ms | 16.2 ms | n/a | `3444b57e9` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 4.8 ms | 15.2 ms | n/a | `3444b57e9` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 5.9 ms | 15.2 ms | n/a | `3444b57e9` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.14 ms | 6.45 ms | < 16 ms | `3444b57e9` |
| typing_busy_per_char | 1,000 | 59 | 4.84 ms | 7.86 ms | < 16 ms | `3444b57e9` |
| typing_busy_per_char | 2,000 | 59 | 6.51 ms | 9.43 ms | < 16 ms | `3444b57e9` |
