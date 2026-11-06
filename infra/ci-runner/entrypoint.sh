#!/bin/bash
# Reads the one-shot JIT runner config from stdin, so it is never in argv, in `docker inspect`, in an
# image layer or in a log. The runner takes it from ACTIONS_RUNNER_INPUT_JITCONFIG and deletes that
# from its own environment before starting a job (actions/runner v2.338.2 CommandSettings.cs).
#
# A job on this runner runs as the same UID, so it could still read this runner's own config. That
# credential is single-runner and single-job, and dies with the container: see ISOLATION.md.
set -euo pipefail

# Anything other than `run` is a local command (tests and the suite harness); no runner starts.
if [ "$#" -gt 0 ] && [ "$1" != "run" ]; then
  exec "$@"
fi

IFS= read -r jit || true
if [ -z "${jit:-}" ]; then
  echo "uct-ci: no JIT config on stdin; refusing to start a runner" >&2
  exit 64
fi
export ACTIONS_RUNNER_INPUT_JITCONFIG="$jit"
unset jit
cd /home/runner/actions-runner
exec ./run.sh
