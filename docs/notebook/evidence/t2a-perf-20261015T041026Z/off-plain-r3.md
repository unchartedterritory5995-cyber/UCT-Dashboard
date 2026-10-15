> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-plain-r3.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-plain-r3.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 43.8 ms | 58.4 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 88.3 ms | 143.8 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 164.6 ms | 206.7 ms | n/a | `6273205ad` |
| typing_per_char | 1 | 60 | 5.3 ms | 15.7 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 9.2 ms | 16.8 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 12.5 ms | 19.9 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.55 ms | 8.12 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 9.63 ms | 13.21 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 13.53 ms | 18.29 ms | < 16 ms | `6273205ad` |
