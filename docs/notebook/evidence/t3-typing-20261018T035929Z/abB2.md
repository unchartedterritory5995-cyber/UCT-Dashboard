> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t3\docs\notebook\evidence\t3-typing-20261018T035929Z\abB2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t3\docs\notebook\evidence\t3-typing-20261018T035929Z\abB2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 32.3 ms | 39.5 ms | < 300 ms | `42394619e` |
| note_open | 1,000 | 20 | 53 ms | 67.2 ms | < 300 ms | `42394619e` |
| note_open | 2,000 | 20 | 94.6 ms | 150.5 ms | n/a | `42394619e` |
| typing_per_char | 1 | 60 | 3.5 ms | 16.3 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 5.8 ms | 15.1 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 8.4 ms | 18 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 4.24 ms | 6.43 ms | < 16 ms | `42394619e` |
| typing_busy_per_char | 1,000 | 59 | 5.31 ms | 6.93 ms | < 16 ms | `42394619e` |
| typing_busy_per_char | 2,000 | 59 | 10.01 ms | 12.87 ms | < 16 ms | `42394619e` |
