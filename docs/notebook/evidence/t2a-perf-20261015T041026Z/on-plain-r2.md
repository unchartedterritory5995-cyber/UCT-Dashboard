> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-plain-r2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-plain-r2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 41.1 ms | 50.3 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 124.3 ms | 164.7 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 174.8 ms | 194 ms | n/a | `6273205ad` |
| typing_per_char | 1 | 60 | 5 ms | 14.9 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 10.4 ms | 18.9 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 13 ms | 17.1 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 6.52 ms | 7.67 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 9.97 ms | 12.62 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 13.97 ms | 21.59 ms | < 16 ms | `6273205ad` |
