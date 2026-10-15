> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-blocks-r1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\on-blocks-r1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 61.7 ms | 73.2 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 110.8 ms | 145.2 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 199.2 ms | 224.2 ms | n/a | `6273205ad` |
| typing_per_char | 1,000 | 60 | 9.8 ms | 16.7 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 13.6 ms | 19.9 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 6.05 ms | 8.26 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 9.64 ms | 11.82 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 13.23 ms | 18.87 ms | < 16 ms | `6273205ad` |
| INCONCLUSIVE | | | | | | typing (wall-clock) at 1 paragraphs: 59 samples for 60 keys sent |
