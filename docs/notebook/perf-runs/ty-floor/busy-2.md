> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\busy-2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\busy-2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 5 | 33.7 ms | 43 ms | < 300 ms | `dfa326c33` |
| note_open | 1,000 | 5 | 75.4 ms | 101.3 ms | < 300 ms | `dfa326c33` |
| note_open | 2,000 | 5 | 172.8 ms | 220 ms | n/a | `dfa326c33` |
| typing_per_char | 1 | 60 | 4.6 ms | 17.1 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 1,000 | 60 | 7.8 ms | 16.7 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 2,000 | 60 | 13.6 ms | 21 ms | < 16 ms | `dfa326c33` |
| typing_busy_per_char | 1 | 59 | 5.02 ms | 7.62 ms | n/a | `dfa326c33` |
| typing_busy_per_char | 1,000 | 59 | 6.74 ms | 9.75 ms | n/a | `dfa326c33` |
| typing_busy_per_char | 2,000 | 59 | 15.04 ms | 19.47 ms | n/a | `dfa326c33` |
