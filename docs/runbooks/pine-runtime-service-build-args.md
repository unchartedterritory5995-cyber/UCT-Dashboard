# Runbook: the pine-runtime service's build args and variables (W5-INT)

For the owner, when creating the `pine-runtime` Railway service (design
`docs/pine/SERVER-RUNTIME-DESIGN.md` 3.1, T20). Nothing here creates a service. Read it before
setting any variable on the service.

## The short answer

The service needs **no secret build args**. Its only build args are two non-secret feature flags.
Its only secret is the HMAC key it shares with web. **Never** copy web's variables onto it, and
never duplicate it from `web`, because Railway copies every variable when it duplicates a service.

| Variable | Kind | Value | Why |
|---|---|---|---|
| `PINE_RUNTIME_SERVICE_SECRET` | runtime secret | the same value web uses to sign (comma list for rotation, each entry at least 32 chars) | HMAC of every `/v1/run` and `/v1/metrics` (design 3.6) |
| `PORT` | runtime, optional | Railway sets it | listener port (default 8080) |
| `VITE_PINE_LOWER_TF_ENABLED` | build arg, **not secret**, optional | exactly web's value (`1` or unset) | baked into `pine-runtime.mjs`; lower-timeframe serving (`engine/lowerTfGate.js`) |
| `VITE_PINE_RUNTIME_PANE_ENABLED` | build arg, **not secret**, optional | exactly web's value (`1` or unset) | baked into `pine-runtime.mjs`; the runtime-pane build flag (`engine/runtimePaneGate.js`) |

Set a flag on the service only when web sets it, and to the same value. That is the H3
"one value" rule: the bundle the service runs must be the build web runs. Unset reads as off on
both hosts (fail closed).

## Why only these

- `app/scripts/build-pine-runtime.mjs` bakes `import.meta.env` into the bundle at build time.
  esbuild's `define` inlines the whole object at every read. Before W5-INT the build baked
  **every** `VITE_*` in its environment, so a service holding web's `VITE_CHART_RENDER_TOKEN` or
  `VITE_PICOVOICE_ACCESS_KEY` would have written them into `pine-runtime.mjs` (proven on the
  integration base: a marker value appeared in the bundle).
- Now the build bakes only `SERVER_BUNDLE_VITE_NAMES` (the two flags above). Any other `VITE_*`
  in the environment is ignored. `serverBundle.rail.test.js` builds with web's secret names set
  and fails if a marker value, or any `VITE_` name off the list, is in the bundle.
- `services/pine_runtime/Dockerfile` declares only those two as `ARG`. On Railway a service
  variable whose name matches an `ARG` becomes a build arg. With no other `ARG`, no other variable
  reaches the build stage.
- On Railway a service variable is also a runtime variable. The service refuses to boot on any
  variable outside `ENV_ALLOWLIST` (`services/pine_runtime/server.mjs`, design L2). The two flags
  are on it, so mirroring web's flag does not refuse the boot. Any other `VITE_*` (or anything
  else) on the service **refuses the boot by name**, which is how a service duplicated from web is
  caught before it serves.

## Checks the rails hold (do not hand-check these)

- `tests/test_pine_runtime_dockerfile.py`: the image's `ARG` set equals `SERVER_BUNDLE_VITE_NAMES`;
  each is declared in `Dockerfile.web` and read by the frontend; no secret-shaped name; the
  `ENV_ALLOWLIST` `VITE_*` names equal the same list; the canary's inputs are copied and a staged
  copy of the image's files imports the server and loads the canary under Node 20 module rules.
- `app/src/components/chart/engine/runtime/__tests__/serverBundle.rail.test.js`: the define set and
  the built bundle carry nothing off the list.

## If a flag is added to the bundle's closure

The rail `the allowlist is exactly the VITE_* names the bundle reads` goes red. Then add the name
to `SERVER_BUNDLE_VITE_NAMES` (only if it is a non-secret constant), to the Dockerfile `ARG`/`ENV`
block, and to `ENV_ALLOWLIST`, and add a row to this table. A secret never goes on the list; cut
the read out of the closure instead (W5-T2).
