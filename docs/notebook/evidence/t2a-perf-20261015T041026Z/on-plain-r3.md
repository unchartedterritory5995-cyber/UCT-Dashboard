> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-plain-r3.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-plain-r3.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 26.2 ms | 34 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 49.8 ms | 74.2 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 89.8 ms | 133.8 ms | n/a | `6273205ad` |
| typing_per_char | 1 | 60 | 3.1 ms | 15.4 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 4.6 ms | 16.4 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 5.9 ms | 15.3 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.41 ms | 5.0 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 5.67 ms | 8.21 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 10.26 ms | 13.26 ms | < 16 ms | `6273205ad` |
