> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\busy-1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\busy-1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 5 | 29.6 ms | 32.7 ms | < 300 ms | `dfa326c33` |
| note_open | 1,000 | 5 | 72.9 ms | 100 ms | < 300 ms | `dfa326c33` |
| note_open | 2,000 | 5 | 155.8 ms | 209.8 ms | n/a | `dfa326c33` |
| typing_per_char | 1 | 60 | 4.4 ms | 14.6 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 1,000 | 60 | 6.3 ms | 16.7 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 2,000 | 60 | 12.8 ms | 19.1 ms | < 16 ms | `dfa326c33` |
| typing_busy_per_char | 1 | 59 | 4.25 ms | 7.78 ms | n/a | `dfa326c33` |
| typing_busy_per_char | 1,000 | 59 | 6.73 ms | 10.13 ms | n/a | `dfa326c33` |
| typing_busy_per_char | 2,000 | 59 | 13.54 ms | 20.96 ms | n/a | `dfa326c33` |
