> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-p2b\docs\notebook\perf-runs\p2b\blocks-r2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-p2b\docs\notebook\perf-runs\p2b\blocks-r2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 29.4 ms | 33.6 ms | < 300 ms | `fbc92fc25` |
| note_open | 1,000 | 20 | 54.4 ms | 68.1 ms | < 300 ms | `fbc92fc25` |
| note_open | 2,000 | 20 | 94 ms | 123.3 ms | n/a | `fbc92fc25` |
| typing_per_char | 1 | 60 | 3.5 ms | 15.8 ms | n/a | `fbc92fc25` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 5.1 ms | 15.3 ms | n/a | `fbc92fc25` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 8.2 ms | 17.1 ms | n/a | `fbc92fc25` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 4.04 ms | 6.42 ms | < 16 ms | `fbc92fc25` |
| typing_busy_per_char | 1,000 | 59 | 5.06 ms | 7.18 ms | < 16 ms | `fbc92fc25` |
| typing_busy_per_char | 2,000 | 59 | 7.22 ms | 11.82 ms | < 16 ms | `fbc92fc25` |
