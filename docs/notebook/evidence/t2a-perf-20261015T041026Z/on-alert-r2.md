> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-alert-r2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-alert-r2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 38.6 ms | 53.4 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 123.4 ms | 154 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 168.3 ms | 193.3 ms | n/a | `6273205ad` |
| typing_per_char | 1 | 60 | 5.1 ms | 16.2 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 10.9 ms | 19.2 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 14.2 ms | 19.2 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.83 ms | 8.82 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 9.85 ms | 15.72 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 15.46 ms | 19.95 ms | < 16 ms | `6273205ad` |
