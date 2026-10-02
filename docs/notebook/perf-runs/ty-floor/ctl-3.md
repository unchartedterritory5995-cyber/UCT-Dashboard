> SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot (+15s) CLEAN, shutdown CLEAN; 62 db files hashed; post-prewarm (+120s) not reached: the run ended before it (--hold-past-prewarm waits for it); stop: graceful to the shutdown checkpoint, then forced exit; launcher output: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\ctl-3.sandbox.log; log: C:\Users\Patrick\uct-worktrees\notebook-w10-ty4\docs\notebook\perf-runs\ty-floor\ctl-3.integrity.md

| measure | paragraphs | samples | p50 | p95 | budget | tree |
|---|---:|---:|---:|---:|---:|---|
| note_open | 1 | 5 | 29.7 ms | 30.7 ms | < 300 ms | `dfa326c33` |
| note_open | 1,000 | 5 | 77.5 ms | 94.6 ms | < 300 ms | `dfa326c33` |
| note_open | 2,000 | 5 | 145.7 ms | 196 ms | n/a | `dfa326c33` |
| typing_per_char | 1 | 60 | 3.1 ms | 16.1 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 1,000 | 60 | 5.9 ms | 15.5 ms | < 16 ms | `dfa326c33` |
| typing_per_char | 2,000 | 60 | 13 ms | 19.3 ms | < 16 ms | `dfa326c33` |
