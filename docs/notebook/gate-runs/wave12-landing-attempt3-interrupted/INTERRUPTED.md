# Wave-12 landing gate, attempt 3 -- INTERRUPTED (not a verdict)

Tree 0c437e7c6d, `--shards 6 --max-workers 1`, started 2026-10-02 20:43 CT.
Shards 1-4 completed (logs here). Stopped by the controller at 23:48 CT during shard 5:
at ~23:44 the shared node_modules these worktrees link to was partly deleted (the
`notebook-w10-l13` worktree was removed; `.bin` and every package before `@esbuild`,
Babel included, were gone), so shards 5-6 could not produce valid results.
No manifest was written. These logs are raw evidence only; the gate is re-run in full
against a fresh install (`_nb-shared-install`).
