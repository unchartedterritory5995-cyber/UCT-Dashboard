# Instruments — copies kept for the restart checkpoint (2026-09-13)

These ran from the session scratchpad; copied here so a cleaned `%TEMP%` cannot lose them. None is
collected by pytest (no `test_` prefix). Run from the worktree root unless noted.

## ⛔⛔ READ FIRST — every `mutation_harness*.py` is now GUARDED (B4/B5, owner rulings 2026-09-14)

A mutation harness edits a real source file in place. Killed mid-run it **leaves the mutation
behind** — which is what happened to `badge.py` in the integrator's tree. So:

1. **A harness refuses to run outside a sacrificed worktree** (`harness_guard.py`, exit **86**).
   In the throwaway worktree's root, once:
   `echo 'throwaway worktree - mutation harnesses may edit files here' > .mutation-sandbox`
   The marker is **gitignored**, so it can never arrive in another tree by checkout, and the main
   checkout (`.git` is a directory) is refused even with one.
2. **A harness refuses to start a run whose anchors are already stale** (`anchor_check.py`, exit
   **87**) — NOT-APPLIED detection before the run, not 18 minutes into it.

Run the gate step **before any harness**, every time:
`python docs/discord-render/instruments/anchor_check.py .`

Both overrides need an exact value and print a banner naming the tree — an override exists so that
it is a deliberate act, not so that it is the way past a red. Full rules: `../08-merge-queue.md`.

| File | What it is | How it is run |
|---|---|---|
| **`harness_guard.py`** | **B4** — the ONE refusal guard, imported by every harness, never copy-pasted. Also carries the B5 preflight. | `python <file>` runs its self-check (13 cases, refuse **and** allow) |
| **`anchor_check.py`** | **B5** — the gate step. A READ over every harness's controls: OK / STALE / AMBIGUOUS / UNREADABLE, reported **by name**. Never imports a harness, never runs pytest, never writes. | `python <file> .` · `--verbose` · `--self-check` |
| **`prove_b45_rails.py`** | the mutation proofs for B4 and B5's own rails (18) | `python -u <file> .` |
| `mutation_harness.py` | 2.1a proofs (core + corrected tests) | `python <file> .` |
| `mutation_harness_v2router.py` | 2.1b proofs (router, commands, lifespan) | `python <file> .` |
| `mutation_harness_envlogs.py` | Phase 0 log-tool proofs | `python <file> .` |
| `mutation_harness_observe.py` | 2.2 proofs (18) | `python <file> .` |
| `mutation_harness_renderer.py` | 2.3 proofs (22: renderer + web correlation) | `python <file> .` |
| `mutation_harness_symbols.py` | 2.4a proofs (22) | `python <file> .` |
| `mutation_harness_adapters.py` | 2.4b P2.1 proofs (the adapters, the spine, the envelope, the wiring and the kill switch) | `python -u <file> .` — ⚠️ **`-u`**: without it the report sits in a pipe buffer until the process exits, which on a 40-mutation run looks exactly like a hang |
| `prove_eol_gate.py` | R-2 end-to-end proof of the line-ending gate: plants a real flip in two CRLF-stored files, asserts RED in both modes, restores sha-verified, and measures the direction git ABSORBS | `python <file>` |
| `renderer_pool_smoke.py` | real-Chromium measurement of the renderer pool (needs local Playwright) | `python <file> . 48` |
| `verify_merge.py` | post-deploy HTTP checks (its in-process step is broken on Windows; use `pod_env_probe.py`) | `python <file> <sha>` |
| `pod_env_probe.py` | reads `/proc/1/environ` of the RUNNING web process: commit, V2 flag, webhook | Git Bash: ``B64=$(base64 -w0 <file>); MSYS_NO_PATHCONV=1 railway ssh -s web echo "$B64" "\|" base64 -d "\|" /opt/venv/bin/python`` |
| `renderer_health_probe.py` | chart-renderer `/health` read from inside the web pod | same shape as above |
| `drender_symbols_probe.py` | read-only resolve/flow_source measurement on production data | upload `symbols.py` + this with `pod_upload.sh`, then `MSYS_NO_PATHCONV=1 railway ssh -s web -- sh -c 'cd /app; PYTHONPATH=/app timeout 200 /opt/venv/bin/python /tmp/drender_symbols_probe.py 2>&1 \| tail -6'` |
| `pod_upload.sh` | chunked, sha-checked upload of a file into the web pod | `bash <file> <local> <remote>` |
| `run_env_logs.py` | Phase 0 driver for `tools/railway_env_logs.py` | `python <file>` |
