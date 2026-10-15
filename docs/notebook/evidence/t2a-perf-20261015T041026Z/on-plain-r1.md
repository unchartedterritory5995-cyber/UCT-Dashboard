> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN, post-prewarm (+120s) CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-plain-r1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-plain-r1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 31.7 ms | 44.3 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 90.8 ms | 132.5 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 166.9 ms | 197.6 ms | n/a | `6273205ad` |
| typing_per_char | 1 | 60 | 4.5 ms | 14.7 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 9.2 ms | 16.5 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 11.9 ms | 16.9 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.36 ms | 6.2 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 9.16 ms | 11.38 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 12.83 ms | 16.05 ms | < 16 ms | `6273205ad` |
