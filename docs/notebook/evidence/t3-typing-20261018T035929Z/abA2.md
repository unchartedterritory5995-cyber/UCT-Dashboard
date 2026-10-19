> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-t3\docs\notebook\evidence\t3-typing-20261018T035929Z\abA2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-t3\docs\notebook\evidence\t3-typing-20261018T035929Z\abA2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 20 | 31.7 ms | 37.5 ms | < 300 ms | `42394619e` |
| note_open | 1,000 | 20 | 51.3 ms | 61.4 ms | < 300 ms | `42394619e` |
| note_open | 2,000 | 20 | 104.5 ms | 169.6 ms | n/a | `42394619e` |
| typing_per_char | 1 | 60 | 3.8 ms | 16.4 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 1,000 | 60 | 4.5 ms | 16.7 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_per_char | 2,000 | 60 | 7.3 ms | 18.1 ms | n/a | `42394619e` (wall-clock; not the budget's reading (ruling D24) -- see typing_busy_per_char) |
| typing_busy_per_char | 1 | 59 | 3.78 ms | 5.95 ms | < 16 ms | `42394619e` |
| typing_busy_per_char | 1,000 | 59 | 5.57 ms | 7.73 ms | < 16 ms | `42394619e` |
| typing_busy_per_char | 2,000 | 59 | 10.34 ms | 13.21 ms | < 16 ms | `42394619e` |
