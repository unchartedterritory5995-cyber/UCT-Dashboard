> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-p2b\docs\notebook\perf-runs\p2b\blocks-r3.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-p2b\docs\notebook\perf-runs\p2b\blocks-r3.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 30.4 ms | 37.1 ms | < 300 ms | `fbc92fc25` |
| note_open | 1,000 | 20 | 53 ms | 63.5 ms | < 300 ms | `fbc92fc25` |
| note_open | 2,000 | 20 | 90.6 ms | 112.2 ms | n/a | `fbc92fc25` |
| typing_per_char | 1 | 60 | 3.2 ms | 16.1 ms | n/a | `fbc92fc25` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 5.6 ms | 17 ms | n/a | `fbc92fc25` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 7.1 ms | 18.2 ms | n/a | `fbc92fc25` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.69 ms | 7.24 ms | < 16 ms | `fbc92fc25` |
| typing_busy_per_char | 1,000 | 59 | 4.94 ms | 8.37 ms | < 16 ms | `fbc92fc25` |
| typing_busy_per_char | 2,000 | 59 | 6.66 ms | 11.38 ms | < 16 ms | `fbc92fc25` |
