# W5-T10 Image: evidence

Branch `feat/pine-w5-t10-image`, stacked on W5-T7 `5e6c63e24e` (T1 -> T6 -> T7). Files only: no Railway service, no CLI, no deploy.

## What is new
- `services/pine_runtime/Dockerfile`: root-context build. Stage 1 is `Dockerfile.web`s `FROM node:20.18.0-bookworm-slim AS frontend` plus its byte-identical VITE_* ARG/ENV block and its `npm install && npm run build`, then `node scripts/build-pine-runtime.mjs`. Stage 2 is `debian:bookworm-slim` + `libstdc++6`, copies only the node binary, `pine-runtime.mjs` (to `/app/app/dist-server/`, where `server.mjs` DEFAULT_BUNDLE resolves it) and each `services/pine_runtime/*.mjs` one COPY per file. `USER 1000:1000`; no ENV (L2 allowlist); CMD `node --experimental-permission --allow-fs-read=/app --allow-worker --disallow-code-generation-from-strings /app/services/pine_runtime/server.mjs` (L4; Node 20.18 spells it `--experimental-permission`, per T7 evidence).
- `services/pine_runtime/railway.json`: DOCKERFILE builder, path `services/pine_runtime/Dockerfile`, design 3.1 watch patterns (+ the bundle build script), healthcheck `/health`, ALWAYS restart, no volume, no startCommand (the CMD is the one authority for the flags).
- `tests/test_pine_runtime_dockerfile.py` (12 tests): parses `Dockerfile.web` and the image; Node pin, ARG set and ENV block equal (read, not retyped); every VITE_* the frontend reads is declared (via `tools.vite_flag_index`); module list derived from the directory (so T9 canary.mjs is caught when added); COPY lines individual, existing, no wildcard; bundle/node destinations; non-root; L4 flags present and no write/child/addon grants; runtime ENV names vs `ENV_ALLOWLIST` read from `server.mjs` via node; railway.json.

## Local build
Docker is not installed on this machine (`which docker`: not found), so the image was NOT built or run here. Read-only FS is enforced at run time (`docker run --read-only --tmpfs /tmp`) and by the permission model; not exercised. First real build is the owner-side service creation.

## Rails (red on base, green on tip)
- Green on tip: `pytest tests/test_pine_runtime_dockerfile.py` 12 passed.
- Red on base: with the two new service files moved aside (byte-exact restore), 12 failed in 1.41s. On base the test file itself does not exist.

## Mutation table (run through `heavy-mut.lock`; script mutates, runs the file, restores saved bytes, asserts byte-equality)
| mutation | killed by |
|---|---|
| Node pin 20.18.0 -> 20.18.1 | node_pin_equals_dockerfile_web |
| drop one ARG | vite_arg_set_equals_dockerfile_web |
| drop one ENV mirror | vite_env_block_equals_dockerfile_web |
| drop COPY pool.mjs | every_service_module_is_copied_individually |
| wildcard COPY replaces a file | every_service_module_is_copied_individually |
| add temp canary.mjs on disk (T9 case) | every_service_module_is_copied_individually |
| drop USER / USER root | runs_non_root |
| drop --disallow-code-generation / --allow-worker / --experimental-permission; add --allow-fs-write | l4_node_flags_on_the_process |
| add `ENV NODE_ENV` to runtime | image_sets_no_env_the_service_would_refuse |
| bundle dest moved | bundle_and_node_are_copied_... |
| node binary not copied | bundle_and_node_are_copied_... |
| bundle build step dropped / web build line changed | build_runs_the_same_frontend_build_then_the_bundle |
| healthcheck, watch pattern, dockerfilePath, volume in railway.json | railway_json_points_at_the_image_and_watches_the_closure |

20 mutations plus the new-module case, 0 survivors, control green. (A first run had one BADMATCH from my script; re-run killed.)

## Engine bump
No: no engine code touched; SCRIPT_ENGINE_VERSION untouched.

## Open items
- Image never built (no Docker here); `libstdc++6` on `debian:bookworm-slim` for the copied node binary is by analogy with `Dockerfile.web`, unproven.
- The image sets no read-only flag; Railway has no such field, so L4 rests on the permission model and the boot self-test (T7).
- OPEN ITEM FOR THE COORDINATOR (W5-T9 canary): `canary.mjs` and `metrics.mjs` need, inside the image at boot, `tools/pine_runtime_host_parity.mjs`, `runtime/columnDigest.js` and `runtime/__fixtures__/hostParity/**` (expected-digests.json + corpus). They are not on this branch (base T7, no T4/T9), so they are not copied here and no rail can verify them. After T4 and T9 merge, the Dockerfile must add explicit COPY lines for those three and the rail should check them. The `*.mjs` copy rail is derived from the directory, so canary.mjs and metrics.mjs are covered the moment they land (mutation: a temp canary.mjs on disk turns it red).

## Final-tip (tip 4e35b16e91, tested on the T7 base 5e6c63e24e; the later commit only appends this section)
- gate pytest 46 passed; hygiene clean (34701 files); rails pytest 12 passed.
- full chart+hooks vitest: Test Files 1 failed | 1334 passed | 27 skipped; Tests 1 failed | 22366 passed | 118 skipped. The one failure is the baseline `pollingSites.rail`.
- Logs: C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/dsk-w5t10-final/ and runs/dsk-w5t10-final.out (job held the lock 46.9 min).
