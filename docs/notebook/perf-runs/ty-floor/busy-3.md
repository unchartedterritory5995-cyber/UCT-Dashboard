> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\busy-3.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\busy-3.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 5 | 32.2 ms | 34.7 ms | < 300 ms | `dfa326c33` |
| note_open | 1,000 | 5 | 97.6 ms | 141.7 ms | < 300 ms | `dfa326c33` |
| note_open | 2,000 | 5 | 132.7 ms | 144.7 ms | n/a | `dfa326c33` |
| typing_per_char | 1 | 60 | 3.4 ms | 14.8 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 1,000 | 60 | 9.4 ms | 18 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 2,000 | 60 | 13.2 ms | 18.6 ms | < 16 ms | `dfa326c33` |
| typing_busy_per_char | 1 | 59 | 5.62 ms | 7.59 ms | n/a | `dfa326c33` |
| typing_busy_per_char | 1,000 | 59 | 9.18 ms | 11.2 ms | n/a | `dfa326c33` |
| typing_busy_per_char | 2,000 | 59 | 14.88 ms | 21.06 ms | n/a | `dfa326c33` |
