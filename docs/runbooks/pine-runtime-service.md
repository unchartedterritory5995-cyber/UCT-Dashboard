# Pine runtime service: gate, pre-merge checklist, Railway steps, smoke, rollback

Design: `docs/pine/SERVER-RUNTIME-DESIGN.md` (sections 3.8, 3.9, 7 T19/T20, 8). This file is the
operating procedure. The service runs member-supplied Pine through the SAME runtime bundle the chart
uses, on Node 20.18.0, in a private Railway service (`pine-runtime`), so alerts, scans and backtests
can evaluate runtime documents. Everything is staged: nothing here arms anything by itself.

| piece | where |
|---|---|
| gate (offline, every master push) | `.github/workflows/master-deploy-gate.yml`, steps named `Pine runtime - ...` |
| gate rail | `tests/test_pine_runtime_deploy_gate.py` |
| image | `services/pine_runtime/Dockerfile`, `services/pine_runtime/railway.json` |
| host parity | `tools/pine_runtime_host_parity.mjs` (Node half), `tools/pine_runtime_host_parity.py` (Chromium half) |
| post-deploy smoke | `tools/pine_runtime_service_smoke.py` (W5-T9) |

## 1. Pre-merge checklist (coordinator, before a pine-runtime change reaches master)

1. **Heavy rails under the lock** (too heavy for the gate): HP-2/HP-3, the Chromium half over the full
   corpus: `python tools/pine_runtime_host_parity.py --dist app/dist --out <dir>` after a vite build; and
   the C18 object-door diff count (must be 0 unintended). HP-3 reports (does not gate) the two named
   trig cases; every other case must be equal.
2. **Engine bump** (`app/src/components/chart/engine/scriptEngineVersion.js`, coordinator only). If the engine
   identity moved, regenerate the digests in the same merge:
   `node tools/pine_runtime_host_parity.mjs --host node --write` (it refuses to move a digest without a
   bump), and re-record the smoke digest: `python tools/pine_runtime_service_smoke.py --record` against a
   running service. `--write` runs on the recording V8 (see section 2); never on the gate's Node 20.
3. **Image contents.** `services/pine_runtime/Dockerfile` copies each `services/pine_runtime/*.mjs`
   individually. W5-T9's `canary.mjs` imports `tools/pine_runtime_host_parity.mjs`, which reads
   `runtime/columnDigest.js` and `runtime/__fixtures__/hostParity/**` (`corpus.json`,
   `expected-digests.json`, `corpus/*.pine`). When T9 merges the Dockerfile MUST gain explicit `COPY`
   lines for those three, or the service will not boot with its canary. The rail
   `test_the_image_ships_what_the_canary_imports_the_day_t9_lands` goes red the moment `canary.mjs` is in
   the tree without them. The tool loads the bundle build script lazily (only for `--check`), so the
   image does not need `esbuild`.
4. **The image has never been built.** Docker is not installed on the builder machines and the gate does
   not build it (section 8 does not ask for it). Before the owner creates the service, build it once
   where Docker exists: `docker build -f services/pine_runtime/Dockerfile -t pine-runtime:test .`, then
   `docker run --rm --read-only --tmpfs /tmp -e PINE_RUNTIME_SERVICE_SECRET=<throwaway> -p 8080:8080
   pine-runtime:test` and `curl -s localhost:8080/health`. Unproven until then: `libstdc++6` on
   `debian:bookworm-slim` for the copied `node` binary (by analogy with `Dockerfile.web`), the read-only
   filesystem, and the L4 flags on the real image. Throwaway secret only; never a production value.
5. **Node pin.** `FROM node:20.18.0-...` in `services/pine_runtime/Dockerfile` equals `Dockerfile.web`
   (rail), and the gate's `setup-node` major equals it (rail). Raising Node moves V8 and therefore HP-1/HP-3:
   a separate decision, with the digests re-recorded on the new V8.
6. **Watch patterns** in `services/pine_runtime/railway.json` stay in step with the engine closure (the
   T2 closure rail, once built, prints any module outside the patterns).

## 2. The gate (what it runs, and how to read a red)

The steps run after the gate's `npm ci`, in this order, with no `if:` and no `continue-on-error`.
Reproduce locally from the repo root (bash):

| # | step | command |
|---|---|---|
| 0 | the runner's Node major equals the image's `FROM node:` major (read from the Dockerfile) | see the workflow |
| 1 | bundle builds and imports under bare Node | `(cd app && node scripts/build-pine-runtime.mjs && node -e "import('./dist-server/pine-runtime.mjs')")` |
| 2 | host parity, Node half: HP-1 + HP-5, then the HP-4 control | `node tools/pine_runtime_host_parity.mjs --host node --check` and `... --mutation-control` |
| 3 | engine identity (HP-6) and adapters (HP-7) | `pytest tests/test_pine_runtime_engine_identity.py` |
| 4 | closure stays host-neutral | `node tools/pine_runtime_closure.mjs --check` (W5-T2; exits 1 on any finding). **The tool must be on `master` before this workflow is: the step is red without it.** |
| 5 | service unit rails | `node --test services/pine_runtime/test/*.test.mjs` |
| 6 | client, codec, stamps, telemetry, this gate's rail | `pytest tests/test_pine_runtime_client.py tests/test_pine_runtime_codec.py tests/test_pine_runtime_deploy_gate.py ...` |
| 7 | Dockerfile agreement | `pytest tests/test_pine_runtime_dockerfile.py` |

Reading a red:
- **Step 2, "a digest changed WITHOUT an engine bump"**: output-changing engine work. Bump
  `SCRIPT_ENGINE_VERSION` (coordinator) and regenerate with `--write` on the recording V8.
- **Step 2, exit 2 / INCONCLUSIVE**: a wall-clock stop; never a verdict. The step fails closed. Re-run once;
  a repeat means the runner is too slow for a case, which is a finding, not a flake.
- **Step 0**: the image and the gate disagree on Node. Change `setup-node` or the Dockerfile pin so the
  majors match; never edit the step.
- A red gate does NOT stop a deploy by itself (Railway builds on push); it stops the promotion of
  `production` (`docs/runbooks/deploy-windows.md`). Fix forward.

### HP-1 on Node 20 (V8 11.3) versus the digests recorded on Node 24 (V8 13.6)

V8's `Math.sin`/`Math.cos` differ by 1 ulp between those builds (W5-T4 evidence). On Node 20, HP-1 is
red on exactly `transcendental@forming` and `transcendental@listing`, and equal on the other 164 cases.
The gate handles this explicitly, not by pattern:
- `--check` compares the running V8 with `expected-digests.json` `recordedOn.v8`. Only when they DIFFER
  are the cases named in `corpus.json` `reportOnly` (exactly those two) REPORTED instead of red, and only
  when their sole difference is the digest. Any other case, or any other field (status, guards, warm-up),
  is red. On the recording V8 all 166 cases are gated.
- The two reported cases are therefore gated only where the coordinator runs HP-1 on the recording V8
  (Node 24 locally, step 1 of section 1) and by the Chromium half. A real regression in trig output that
  also changes only those two digests would pass the Node 20 gate; the pre-merge run on the recording V8
  catches it. Alternatives (per-V8 digests, a JS sin/cos in the engine) are in
  `docs/pine/evidence/2026-11-04-w5-t19/EVIDENCE.md`.

## 3. Railway steps for the owner (W5-T20; nothing here is done by an agent)

Do these only after sections 1.3 and 1.4 are satisfied and the gate is green on `master`. Each step is
reversible; section 6 is the rollback.

1. **Secret.** Generate one value locally: `python -c "import secrets; print(secrets.token_hex(32))"`.
   Keep it out of chat, files and commits.
2. **Create the service.** Project, New, GitHub repo (this repository), name it `pine-runtime`. Do NOT
   duplicate `web`: Railway copies the environment on duplication and the service refuses to boot with any
   variable outside its allowlist (`ENV_ALLOWLIST` in `services/pine_runtime/server.mjs`).
3. **Source.** Settings, Source: branch `production` (never `master`; `web` deploys from `production` too).
   Root directory empty (the build context is the repo root). Config-as-code file path:
   `services/pine_runtime/railway.json` (builder DOCKERFILE, healthcheck `/health`, restart ALWAYS).
4. **Watch paths** (set in the dashboard; they are per-service there): `services/pine_runtime/**`,
   `app/src/components/chart/engine/**`, `app/src/lib/marketClock/**`,
   `app/src/components/chart/indicators.js`, `app/src/components/chart/timeframes.js`, `app/src/components/chart/builder/authoring/crossContext.json`,
   `app/package*.json`, `app/vite.config.js`, `app/scripts/build-pine-runtime.mjs`.
5. **Networking.** Generate NO public domain. Private only: `pine-runtime.railway.internal`. The service
   listens dual-stack on `PORT`, default 8080.
6. **Variables on `pine-runtime`: exactly one**, `PINE_RUNTIME_SERVICE_SECRET` = the value from step 1. No
   volume. Sleep-when-idle OFF. One replica.
   Also check that no project-level Shared Variable is attached to `pine-runtime` (Railway can inject
   shared variables without a duplication). The image's `VITE_*` build ARGs (including
   `VITE_CHART_RENDER_TOKEN` and `VITE_PICOVOICE_ACCESS_KEY`, `services/pine_runtime/Dockerfile`) must stay UNSET
   on this service; the W5-INT bundle fix is the lane that removes them from the build, cross-reference it
   before the first deploy.
7. **First deploy: read the log before anything else.** Expected, one line:
   `[pine-runtime] boot engine=<..> bundle=<sha12> node=v20.18.0 workers=N port=8080`. If the log says
   "refuses to start: N variable(s) outside its allowlist", the names are listed; the platform injected a
   variable the allowlist does not know. Report the names; do not add variables and do not widen the list
   by hand. `/health` is liveness (the Railway healthcheck); `/ready` also needs the canary green. Never
   point the Railway healthcheck at `/ready`.
8. **Secret on `web`.** Set the SAME `PINE_RUNTIME_SERVICE_SECRET` on `web`. A Railway `--set` redeploys the
   service; a `delete` does not (CLAUDE.md).
9. **URL on `web`, last.** `PINE_RUNTIME_SERVICE_URL=http://pine-runtime.railway.internal:8080` on `web`.
   Leave `PINE_RUNTIME_SERVER_STAGE` UNSET (off) until the smoke passes.
10. **Smoke** (section 4). Only a green smoke allows the next stage.

## 4. Post-deploy smoke

`python tools/pine_runtime_service_smoke.py` is read-only and takes `PINE_RUNTIME_SERVICE_URL` and
`PINE_RUNTIME_SERVICE_SECRET` from the environment. Exit codes (same convention as
`tools/runtime_pane_smoke.py`):
- **0 PASS**: the boot fingerprint's engine equals web's; the canary is green; a signed `/v1/run` of
  `adx-and-di-for-v4` over the fixed series returns the committed digest; an unsigned request gets 401.
- **1 FAILED**: roll back first (section 6), then investigate.
- **2 INCONCLUSIVE**: never a rollback trigger (no URL or secret, service unreachable from here, canary
  undecided, the digest recorded for another engine).

The service has no public domain, so run the smoke from a host on the Railway private network (for
example `railway ssh --service web`, then the tool and the two variables from web's own environment). From
a laptop it is expected to exit 2. Whether `tools/` is present inside the web image is not verified here:
check after the ssh, and if it is absent, pipe the file in.

## 5. Staged arming (after the smoke is green)

1. `PINE_RUNTIME_SERVER_STAGE=admins` with the allowlist only, for one week. Exit needs: zero
   `runtime:server-integrity`, the canary green, the smoke green on each deploy.
2. `cohort`.
3. `all`. This never runs ahead of the pane stage.

An engine bump restarts `web` and `pine-runtime` on separate triggers; for minutes the client answers
`runtime:server-engine-mismatch` and withholds by name. Run the smoke after both are `SUCCESS`.

## 6. Rollback (design 3.9)

| scope | lever | reach |
|---|---|---|
| one script | its sha256 or def id on `PINE_RUNTIME_KILL_LIST` (web) | next evaluation |
| all server lanes | `PINE_RUNTIME_SERVER_STAGE=off` (web) | next evaluation; runtime alerts read "withheld" by name |
| the service | unset `PINE_RUNTIME_SERVICE_URL` on web, then `railway redeploy --service web` | after the redeploy |
| a bad service build | Railway rollback to the previous `pine-runtime` deployment (stateless, no data migration) | minutes |
| the code | revert on `master`, gate, `production` | a deploy |

Nothing here deletes member data.

## 7. Deploy classification

Tier 1 (`docs/runbooks/deploy-windows.md`): stateless, no volume, not on flow-worker's watch list;
`tools/flow_worker_watch_coverage.py` is unaffected. A push touching the engine restarts `web` and
`pine-runtime`; the never-delay-a-deploy rule stands.
