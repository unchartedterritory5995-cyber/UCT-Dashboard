> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t3\docs\notebook\evidence\t3-typing-20261018T035929Z\abB1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t3\docs\notebook\evidence\t3-typing-20261018T035929Z\abB1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 30.6 ms | 34.6 ms | < 300 ms | `42394619e` |
| note_open | 1,000 | 20 | 49.8 ms | 59.3 ms | < 300 ms | `42394619e` |
| note_open | 2,000 | 20 | 83.8 ms | 145.2 ms | n/a | `42394619e` |
| typing_per_char | 1 | 60 | 4.1 ms | 16.7 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 6.1 ms | 15.3 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 7.6 ms | 17 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 4.32 ms | 6.25 ms | < 16 ms | `42394619e` |
| typing_busy_per_char | 1,000 | 59 | 5.33 ms | 6.9 ms | < 16 ms | `42394619e` |
| typing_busy_per_char | 2,000 | 59 | 9.52 ms | 12.2 ms | < 16 ms | `42394619e` |
