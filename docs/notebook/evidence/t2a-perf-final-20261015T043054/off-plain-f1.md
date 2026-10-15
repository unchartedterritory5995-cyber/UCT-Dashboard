> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\off-plain-f1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t2a\docs\notebook\evidence\t2a-perf-final-20261015T043054\off-plain-f1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 31.1 ms | 50.3 ms | < 300 ms | `c57a084a0` |
| note_open | 1,000 | 20 | 87.5 ms | 163.7 ms | < 300 ms | `c57a084a0` |
| note_open | 2,000 | 20 | 153.4 ms | 193.8 ms | n/a | `c57a084a0` |
| typing_per_char | 1 | 60 | 4.4 ms | 15.7 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 10.2 ms | 17.5 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 12.1 ms | 23.9 ms | n/a | `c57a084a0` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.74 ms | 5.62 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 1,000 | 59 | 7.68 ms | 11.05 ms | < 16 ms | `c57a084a0` |
| typing_busy_per_char | 2,000 | 59 | 12.02 ms | 19.01 ms | < 16 ms | `c57a084a0` |
