> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-plain-r2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-plain-r2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 36.7 ms | 49.5 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 91.1 ms | 133.3 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 176.5 ms | 205.3 ms | n/a | `6273205ad` |
| typing_per_char | 1 | 60 | 4 ms | 13.7 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 12.5 ms | 19.5 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 14.5 ms | 19.1 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.29 ms | 6.82 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 10.51 ms | 18.04 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 13.84 ms | 20.77 ms | < 16 ms | `6273205ad` |
