# V2c2 FINAL GRIND — runbook (recoverable without chat history)

* One authoritative run: `final_grind.py <TAG>` launched through `launch.py` (PID 1 env, branch
  modules overlaid from `/data/_audit/v2cc/code_<md5>`). Artifact `/data/_audit/v2cc/final/breadth_v2c2div_FINAL_<TAG>.db`,
  ledger `LEDGER_<TAG>.json` (rewritten every 5 min), log `/data/_audit/v2cc/log_final_grind_*.txt`.
* Singleton: flock `/data/_audit/v2cc/final/v2c2_final.lock`; a second grinder exits 3.
* Interrupted (container restart, kill): relaunch the SAME code dir with
  `python launch.py final_grind.py <TAG> --resume`. The launcher refuses unless the artifact's clean
  launch record names the SAME INPUT_MANIFEST sha; staleness is judged at the launch instant, every
  other preflight check at the present. Completed checkpoints are skipped; failed ones retried.
* NEVER: delete the partial artifact, launch without --resume on it, run a second grinder, merge
  partial output, change code or inputs mid-run.
* STOP (do not resume) on: invariant violation, manifest/input mismatch, digest mismatch, a canonical
  `uct` row before 2026-03-23, a corrupt checkpoint, any production-write attempt.
