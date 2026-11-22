# services/pine_runtime/Dockerfile  (W5-T10, docs/pine/SERVER-RUNTIME-DESIGN.md sections 3.1 and L4)
#
# THE PINE RUNTIME SERVICE'S IMAGE. Built from the REPO ROOT context (the bundle reads app/src):
#   docker build -f services/pine_runtime/Dockerfile .
# `railway.json` in this folder is the service's config-as-code file; nothing here creates a service.
#
# ONE AUTHORITY, NOT A COPY: the Node pin below is the one in Dockerfile.web.
# `tests/test_pine_runtime_dockerfile.py` parses both files and fails if they differ, if a
# services/pine_runtime/*.mjs is not copied, if a file outside the named allowlist is copied, or if
# the L4 flags go missing.
#
# W5-INT SECRETS: the bundle bakes `import.meta.env` at build time, so this image declares ONLY the
# non-secret VITE_* build constants the bundle reads (app/scripts/build-pine-runtime.mjs
# SERVER_BUNDLE_VITE_NAMES), never web's whole list: VITE_CHART_RENDER_TOKEN and
# VITE_PICOVOICE_ACCESS_KEY have no business in a Railway build of this service. The build script
# also bakes nothing off that list, whatever the environment holds. Owner runbook:
# docs/runbooks/pine-runtime-service-build-args.md.

# STAGE 1 - the bundle. Same Node binary as web (HP-3: a different V8 would move the numbers).
FROM node:20.18.0-bookworm-slim AS frontend
WORKDIR /src

# The ONLY build args: the non-secret flags the bundle reads (= SERVER_BUNDLE_VITE_NAMES; each also
# declared in Dockerfile.web, so a Railway service variable of the same name means the same thing).
ARG VITE_PINE_LOWER_TF_ENABLED
ARG VITE_PINE_RUNTIME_PANE_ENABLED
ENV VITE_PINE_LOWER_TF_ENABLED=$VITE_PINE_LOWER_TF_ENABLED \
    VITE_PINE_RUNTIME_PANE_ENABLED=$VITE_PINE_RUNTIME_PANE_ENABLED
COPY . .
RUN cd app && npm install && NODE_OPTIONS='--max-old-space-size=4096' npm run build && node scripts/build-pine-runtime.mjs

# STAGE 2 - the runtime. Only the node binary, the bundle and the service's own files.
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
# The bundle sits where server.mjs's DEFAULT_BUNDLE resolves it: ../../app/dist-server/pine-runtime.mjs.
COPY --from=frontend /src/app/dist-server/pine-runtime.mjs /app/app/dist-server/pine-runtime.mjs
# Files are listed ONE BY ONE (the chart-renderer lesson: an unlisted module is an ImportError at boot).
COPY services/pine_runtime/auth.mjs /app/services/pine_runtime/auth.mjs
COPY services/pine_runtime/cache.mjs /app/services/pine_runtime/cache.mjs
COPY services/pine_runtime/canary.mjs /app/services/pine_runtime/canary.mjs
COPY services/pine_runtime/job.mjs /app/services/pine_runtime/job.mjs
COPY services/pine_runtime/metrics.mjs /app/services/pine_runtime/metrics.mjs
COPY services/pine_runtime/pool.mjs /app/services/pine_runtime/pool.mjs
COPY services/pine_runtime/protocol.mjs /app/services/pine_runtime/protocol.mjs
COPY services/pine_runtime/sandbox.mjs /app/services/pine_runtime/sandbox.mjs
COPY services/pine_runtime/server.mjs /app/services/pine_runtime/server.mjs
# W5-INT: the parity canary's inputs (canary.mjs, design 3.8), at the paths it resolves from its own
# file. Without them the boot is REFUSED. The named allowlist in the rail holds exactly these four.
# app/package.json carries "type": "module", without which Node 20 reads columnDigest.js as CommonJS.
COPY tools/pine_runtime_host_parity.mjs /app/tools/pine_runtime_host_parity.mjs
COPY app/package.json /app/app/package.json
COPY app/src/components/chart/engine/runtime/columnDigest.js /app/app/src/components/chart/engine/runtime/columnDigest.js
COPY app/src/components/chart/engine/runtime/__fixtures__/hostParity /app/app/src/components/chart/engine/runtime/__fixtures__/hostParity

# L2: nothing but the allowlisted names may be set, so this image sets none (not even NODE_ENV).
# L4: non-root; the root filesystem is never written (run with --read-only --tmpfs /tmp; the
# permission model below also forbids every write and every child process).
USER 1000:1000
CMD ["node", "--experimental-permission", "--allow-fs-read=/app", "--allow-worker", "--disallow-code-generation-from-strings", "/app/services/pine_runtime/server.mjs"]
