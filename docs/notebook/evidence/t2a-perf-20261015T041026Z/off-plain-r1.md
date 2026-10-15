> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN, post-prewarm (+120s) CLEAN; 62 db files hashed; stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-plain-r1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-plain-r1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 44.7 ms | 53.7 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 119.8 ms | 145.6 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 172 ms | 195.4 ms | n/a | `6273205ad` |
| typing_per_char | 1 | 60 | 5 ms | 16.3 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 8.6 ms | 17.1 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 11.3 ms | 16.7 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 5.65 ms | 8.36 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 9.34 ms | 12.7 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 12.85 ms | 15.1 ms | < 16 ms | `6273205ad` |
