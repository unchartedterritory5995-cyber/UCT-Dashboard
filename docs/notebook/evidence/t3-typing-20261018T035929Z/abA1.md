> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t3\docs\notebook\evidence\t3-typing-20261018T035929Z\abA1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t3\docs\notebook\evidence\t3-typing-20261018T035929Z\abA1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 31 ms | 36.8 ms | < 300 ms | `42394619e` |
| note_open | 1,000 | 20 | 52.2 ms | 85.1 ms | < 300 ms | `42394619e` |
| note_open | 2,000 | 20 | 99 ms | 150.4 ms | n/a | `42394619e` |
| typing_per_char | 1 | 60 | 3.6 ms | 15.4 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 5.1 ms | 17.1 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 8.5 ms | 17.6 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.7 ms | 5.14 ms | < 16 ms | `42394619e` |
| typing_busy_per_char | 1,000 | 59 | 5.94 ms | 7.85 ms | < 16 ms | `42394619e` |
| typing_busy_per_char | 2,000 | 59 | 9.9 ms | 13.56 ms | < 16 ms | `42394619e` |
