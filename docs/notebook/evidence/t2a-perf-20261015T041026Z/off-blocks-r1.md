> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-blocks-r1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-20261015T041026Z\off-blocks-r1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 62.2 ms | 116.8 ms | < 300 ms | `6273205ad` |
| note_open | 1,000 | 20 | 148.8 ms | 173.9 ms | < 300 ms | `6273205ad` |
| note_open | 2,000 | 20 | 222.6 ms | 241.9 ms | n/a | `6273205ad` |
| typing_per_char | 1,000 | 60 | 11.2 ms | 20.7 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 13.8 ms | 22 ms | n/a | `6273205ad` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 6.49 ms | 9.89 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 1,000 | 59 | 10.29 ms | 14.09 ms | < 16 ms | `6273205ad` |
| typing_busy_per_char | 2,000 | 59 | 14.34 ms | 20.13 ms | < 16 ms | `6273205ad` |
| INCONCLUSIVE | | | | | | typing (wall-clock) at 1 paragraphs: 59 samples for 60 keys sent |
