# V2c2 FINAL GRIND — runbook (recoverable without chat history)

* One authoritative run: `final_grind.py <TAG>` launched through `launch.py` (PID 1 env, branch
  modules overlaid from `/data/_audit/v2cc/code_<md5>`). Artifact `/data/_audit/v2cc/final/breadth_v2c2div_FINAL_<TAG>.db`,
  ledger `LEDGER_<TAG>.json` (rewritten every 5 min), log `/data/_audit/v2cc/log_final_grind_*.txt`.
* Singleton: flock `/data/_audit/v2cc/final/v2c2_final.lock`; a second grinder exits 3.
* FRESHNESS IS A LAUNCH PROPERTY; IMMUTABILITY IS A RUN PROPERTY. A launch needs a clean preflight
  NOW; the launch records run identity in the artifact (`launch_*` in pass_meta): the preflight's
  evaluation instant, INPUT_MANIFEST sha, PIT UCT ledger sha, pins (code + methodology + universe and
  metric registries), requested range from/to.
* Interrupted (container restart, kill): relaunch the SAME code dir with
  `python launch.py final_grind.py <TAG> --resume`. --resume = CONTINUE THIS EXACT RUN. It refuses
  unless: a clean launch record exists; the manifest sha, the PIT ledger sha, the pins and the
  requested range all equal the launch record; no checkpoint lies outside the range; and the full
  preflight passes again (every input and grouped-file hash, flags, registries) with staleness judged
  at the recorded launch instant. It never refreshes inputs, extends the end date, adopts a newer
  ledger or provider file, or creates a second artifact. Completed checkpoints are skipped; failed
  ones retried. Mutation rails: tests/test_breadth_v2c2_launcher.py.
* NEVER: delete the partial artifact, launch without --resume on it, run a second grinder, merge
  partial output, change code or inputs mid-run.
* STOP (do not resume) on: invariant violation, manifest/input mismatch, digest mismatch, a canonical
  `uct` row before 2026-03-23, a corrupt checkpoint, any production-write attempt.
