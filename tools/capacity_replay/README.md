# capacity_replay: 500 virtual members against a LOCAL bars-api

The harness behind `docs/runbooks/capacity-500.md`. It never contacts production: the sandbox refuses every non-loopback socket and DNS name, blanks vendor/R2 credentials, and opens the store READ-ONLY + immutable.

| file | what |
|---|---|
| `build_universe.py` | `universe.json` from a local `bars.db`: tickers ranked by dollar volume, intraday/W/M holders. Do not commit the output. |
| `replay_members.py` | the member model (`old` / `full` / `edge` modes, see its docstring); `--dry` records the request stream only |
| `cost_model.py` | serve CPU per request class through the real serve core, in-process, single thread |
| `launch_bars_api.py` | ONE sandboxed `api.bars_api_main` process on a port (refuses a worker count: several processes are the topology below) |
| `run_topology.py` | #2962's real leader/follower topology: N processes on one `DATA_DIR` with `BARS_API_WORKERS=N` (one leader, followers that hand leader-only work to it), one port each, client round-robin; members swept per case; aborts under a free-COMMIT-memory floor (default 9 GB); records the share of requests handed to the leader |
| `launch_workers.py` + `sandbox/sitecustomize.py` | the real `BARS_API_WORKERS=N` mode (the sandbox reaches the spawned workers through `sitecustomize`) |
| `run_matrix.py` | N processes x mode x members; fresh processes per case; aborts under 4.5 GB free RAM |
| `micro.py` | closed-loop throughput of one URL |
| `edge/run_edge.mjs` | `bars-edge-router` under workerd (Miniflare). Copy `edge/bars-edge-router/*.js` next to it with `BARS_ORIGIN`/`WEB_ORIGIN` rewritten to `http://127.0.0.1:18100` / `:18199`, then check that no `railway.app` remains |

Heavy: run the matrix inside `python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --solo --timeout 3600 --label "..." -- python run_matrix.py ...`. On Windows, uvicorn's shared-socket workers can fail to `listen` (WinError 10022), so `run_topology.py` gives each process its own port and the clients round-robin; the processes, roles, hand-offs and caps are production's, only the balancer differs (Linux production shares one socket). `run_matrix.py` runs N INDEPENDENT single processes (each its own leader): it measures per-process serve capacity, not the topology.
