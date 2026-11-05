# services/pine_runtime/Dockerfile  (W5-T10, docs/pine/SERVER-RUNTIME-DESIGN.md sections 3.1 and L4)
#
# THE PINE RUNTIME SERVICE'S IMAGE. Built from the REPO ROOT context (the bundle reads app/src):
#   docker build -f services/pine_runtime/Dockerfile .
# `railway.json` in this folder is the service's config-as-code file; nothing here creates a service.
#
# ONE AUTHORITY, NOT A COPY: the Node pin and the VITE_* ARG/ENV block below are byte-for-byte
# the ones in Dockerfile.web. `tests/test_pine_runtime_dockerfile.py` parses both files and fails
# if they differ, if a services/pine_runtime/*.mjs is not copied, or if the L4 flags go missing.

# STAGE 1 - the bundle. Same Node binary as web (HP-3: a different V8 would move the numbers).
FROM node:20.18.0-bookworm-slim AS frontend
WORKDIR /src

# Every VITE_* the frontend reads, exactly as Dockerfile.web declares it: the bundle bakes
# import.meta.env from these at build time (app/scripts/build-pine-runtime.mjs).
ARG VITE_CATALYST_UI_ENABLED
ARG VITE_CHART_RENDER_TOKEN
ARG VITE_CHART_RENDER_TOKEN_PREVIOUS
ARG VITE_COMING_SOON
ARG VITE_DESK_BG_AUDIO_ENABLED
ARG VITE_DISCORD_CHART_APP_ID
ARG VITE_FLOW_DEFER_TAPE
ARG VITE_FLOW_PARTS
ARG VITE_FLOW_SERVER_SEARCH
ARG VITE_FLOW_SERVER_TOPPICKS
ARG VITE_GRID_WARM_ENABLED
ARG VITE_INDICATOR_TEMPLATES_ENABLED
ARG VITE_LAUNCH_DATE
ARG VITE_MASSIVE_CURATED_STREAM
ARG VITE_MASSIVE_STREAM
ARG VITE_PICOVOICE_ACCESS_KEY
ARG VITE_PINE_LOWER_TF_ENABLED
ARG VITE_PINE_MEMBER_PANE_ENABLED
ARG VITE_PINE_OBJECTS_ONLY_PANE_ENABLED
ARG VITE_PINE_RUNTIME_PANE_ENABLED
ARG VITE_SAVED_SCRIPT_UPGRADE
ARG VITE_REALTIME_BARS
ARG VITE_TWITTER_UI_ENABLED
ARG VITE_VOLUME_NUMERIC_PANE_ENABLED
ARG VITE_WS_HOST
ENV VITE_CATALYST_UI_ENABLED=$VITE_CATALYST_UI_ENABLED \
    VITE_CHART_RENDER_TOKEN=$VITE_CHART_RENDER_TOKEN \
    VITE_CHART_RENDER_TOKEN_PREVIOUS=$VITE_CHART_RENDER_TOKEN_PREVIOUS \
    VITE_COMING_SOON=$VITE_COMING_SOON \
    VITE_DESK_BG_AUDIO_ENABLED=$VITE_DESK_BG_AUDIO_ENABLED \
    VITE_DISCORD_CHART_APP_ID=$VITE_DISCORD_CHART_APP_ID \
    VITE_FLOW_DEFER_TAPE=$VITE_FLOW_DEFER_TAPE \
    VITE_FLOW_PARTS=$VITE_FLOW_PARTS \
    VITE_FLOW_SERVER_SEARCH=$VITE_FLOW_SERVER_SEARCH \
    VITE_FLOW_SERVER_TOPPICKS=$VITE_FLOW_SERVER_TOPPICKS \
    VITE_GRID_WARM_ENABLED=$VITE_GRID_WARM_ENABLED \
    VITE_INDICATOR_TEMPLATES_ENABLED=$VITE_INDICATOR_TEMPLATES_ENABLED \
    VITE_LAUNCH_DATE=$VITE_LAUNCH_DATE \
    VITE_MASSIVE_CURATED_STREAM=$VITE_MASSIVE_CURATED_STREAM \
    VITE_MASSIVE_STREAM=$VITE_MASSIVE_STREAM \
    VITE_PICOVOICE_ACCESS_KEY=$VITE_PICOVOICE_ACCESS_KEY \
    VITE_PINE_LOWER_TF_ENABLED=$VITE_PINE_LOWER_TF_ENABLED \
    VITE_PINE_MEMBER_PANE_ENABLED=$VITE_PINE_MEMBER_PANE_ENABLED \
    VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=$VITE_PINE_OBJECTS_ONLY_PANE_ENABLED \
    VITE_PINE_RUNTIME_PANE_ENABLED=$VITE_PINE_RUNTIME_PANE_ENABLED \
    VITE_SAVED_SCRIPT_UPGRADE=$VITE_SAVED_SCRIPT_UPGRADE \
    VITE_REALTIME_BARS=$VITE_REALTIME_BARS \
    VITE_TWITTER_UI_ENABLED=$VITE_TWITTER_UI_ENABLED \
    VITE_VOLUME_NUMERIC_PANE_ENABLED=$VITE_VOLUME_NUMERIC_PANE_ENABLED \
    VITE_WS_HOST=$VITE_WS_HOST
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
COPY services/pine_runtime/job.mjs /app/services/pine_runtime/job.mjs
COPY services/pine_runtime/pool.mjs /app/services/pine_runtime/pool.mjs
COPY services/pine_runtime/protocol.mjs /app/services/pine_runtime/protocol.mjs
COPY services/pine_runtime/sandbox.mjs /app/services/pine_runtime/sandbox.mjs
COPY services/pine_runtime/server.mjs /app/services/pine_runtime/server.mjs

# L2: nothing but the allowlisted names may be set, so this image sets none (not even NODE_ENV).
# L4: non-root; the root filesystem is never written (run with --read-only --tmpfs /tmp; the
# permission model below also forbids every write and every child process).
USER 1000:1000
CMD ["node", "--experimental-permission", "--allow-fs-read=/app", "--allow-worker", "--disallow-code-generation-from-strings", "/app/services/pine_runtime/server.mjs"]
