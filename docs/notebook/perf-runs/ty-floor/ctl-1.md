> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\ctl-1.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\ctl-1.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 5 | 25.3 ms | 26.9 ms | < 300 ms | `dfa326c33` |
| note_open | 1,000 | 5 | 54.9 ms | 59.7 ms | < 300 ms | `dfa326c33` |
| note_open | 2,000 | 5 | 91.5 ms | 144.9 ms | n/a | `dfa326c33` |
| typing_per_char | 1 | 60 | 2.8 ms | 14.6 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 1,000 | 60 | 5.7 ms | 16.4 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 2,000 | 60 | 6.9 ms | 16.8 ms | < 16 ms | `dfa326c33` |
