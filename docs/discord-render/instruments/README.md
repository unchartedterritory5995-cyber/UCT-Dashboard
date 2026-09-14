# Instruments — copies kept for the restart checkpoint (2026-09-13)

These ran from the session scratchpad; copied here so a cleaned `%TEMP%` cannot lose them. None is
collected by pytest (no `test_` prefix). Run from the worktree root unless noted.

| File | What it is | How it is run |
|---|---|---|
| `mutation_harness.py` | 2.1a proofs (core + corrected tests) | `python <file> .` |
| `mutation_harness_v2router.py` | 2.1b proofs (router, commands, lifespan) | `python <file> .` |
| `mutation_harness_envlogs.py` | Phase 0 log-tool proofs | `python <file> .` |
| `mutation_harness_observe.py` | 2.2 proofs (18) | `python <file> .` |
| `mutation_harness_renderer.py` | 2.3 proofs (22: renderer + web correlation) | `python <file> .` |
| `mutation_harness_symbols.py` | 2.4a proofs (22) | `python <file> .` |
| `renderer_pool_smoke.py` | real-Chromium measurement of the renderer pool (needs local Playwright) | `python <file> . 48` |
| `verify_merge.py` | post-deploy HTTP checks (its in-process step is broken on Windows; use `pod_env_probe.py`) | `python <file> <sha>` |
| `pod_env_probe.py` | reads `/proc/1/environ` of the RUNNING web process: commit, V2 flag, webhook | Git Bash: ``B64=$(base64 -w0 <file>); MSYS_NO_PATHCONV=1 railway ssh -s web echo "$B64" "\|" base64 -d "\|" /opt/venv/bin/python`` |
| `renderer_health_probe.py` | chart-renderer `/health` read from inside the web pod | same shape as above |
| `drender_symbols_probe.py` | read-only resolve/flow_source measurement on production data | upload `symbols.py` + this with `pod_upload.sh`, then `MSYS_NO_PATHCONV=1 railway ssh -s web -- sh -c 'cd /app; PYTHONPATH=/app timeout 200 /opt/venv/bin/python /tmp/drender_symbols_probe.py 2>&1 \| tail -6'` |
| `pod_upload.sh` | chunked, sha-checked upload of a file into the web pod | `bash <file> <local> <remote>` |
| `run_env_logs.py` | Phase 0 driver for `tools/railway_env_logs.py` | `python <file>` |
