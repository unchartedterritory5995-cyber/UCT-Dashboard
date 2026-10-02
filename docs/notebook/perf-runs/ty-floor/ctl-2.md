> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\ctl-2.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\ctl-2.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 5 | 29.5 ms | 36 ms | < 300 ms | `dfa326c33` |
| note_open | 1,000 | 5 | 54.9 ms | 92.7 ms | < 300 ms | `dfa326c33` |
| note_open | 2,000 | 5 | 99.2 ms | 119.9 ms | n/a | `dfa326c33` |
| typing_per_char | 1 | 60 | 3.2 ms | 14.8 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 1,000 | 60 | 5.3 ms | 14.4 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 2,000 | 60 | 7.6 ms | 15.4 ms | < 16 ms | `dfa326c33` |
