#!/usr/bin/env python3
"""Exercises launcher.py against REAL Docker with a stub in place of GitHub. Registers nothing, needs no token.

    python3 launcher_real_docker_check.py <image>

Proves, with real containers: a slot starts a container, feeds it a config on stdin, sees it exit, verifies it is
gone and logs that; a killed container reports a failing exit code and is gone; `sweep` removes what a crash left.
The config is deliberately invalid, so the runner exits at once. It never contacts GitHub.
"""
from __future__ import annotations

import base64
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import launcher  # noqa: E402

BOGUS = base64.b64encode(b"not-json").decode()


class StubGitHub:
    def __init__(self):
        self.removed = []

    def jit_config(self, name):
        return 1, BOGUS

    def busy(self, runner_id):
        return False

    def remove(self, runner_id):
        self.removed.append(runner_id)


def count_labelled() -> int:
    out = subprocess.run(["docker", "ps", "-aq", "--filter", f"label={launcher.CONTAINER_LABEL}"],
                         capture_output=True, text=True, check=True)
    return len(out.stdout.split())


def check(label: str, ok: bool, detail="") -> bool:
    print(f"{'PASS' if ok else 'FAIL'} {label} {detail}".rstrip(), flush=True)
    return ok


def main() -> int:
    image = sys.argv[1]
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        cfg = launcher.Config(image=image, log_dir=tmp, min_free_gib=1)
        gh = StubGitHub()
        slots = launcher.Slots(cfg, github=gh)

        first, second = slots.run_once(0), slots.run_once(1)
        # run.sh maps the runner's "terminated, no retry" code to 0, so a bad config exits 0. Exit codes here are not a
        # health signal and no job result travels this way: the runner reports to GitHub. Duration drives the backoff.
        results.append(check("a runner that cannot start is short-lived, so the slot backs off",
                             first["seconds"] < 30, f"exit={first['exit']} seconds={first['seconds']}"))
        results.append(check("the container is verified gone", first["removed"] and second["removed"]))
        results.append(check("each slot run gets its own container", first["name"] != second["name"]))
        results.append(check("the runner is deregistered", gh.removed == [1, 1]))
        results.append(check("nothing is left behind", count_labelled() == 0))
        logs = "".join(p.read_text(encoding="utf-8", errors="replace") for p in pathlib.Path(tmp).iterdir())
        results.append(check("the config is in no log", BOGUS not in logs))

        # A job killed mid-run: what a dead machine or `docker kill` looks like to the launcher.
        name = "uct-ci-killed"
        box = {}

        def victim():
            cmd = [*cfg.docker, *launcher.container_args(cfg, name), cfg.image, "sleep", "120"]
            box["rc"] = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True).returncode

        t = threading.Thread(target=victim)
        t.start()
        time.sleep(3)
        subprocess.run(["docker", "kill", name], capture_output=True, check=True)
        t.join(30)
        results.append(check("a killed job never exits 0", box.get("rc") not in (0, None), f"exit={box.get('rc')}"))
        results.append(check("a killed container is gone", slots.gone(name)))

        # A crash leaves a stopped container that --rm never cleaned, so sweep has real work to do.
        subprocess.run(["docker", "create", "--name", "uct-ci-leftover", "--label", launcher.CONTAINER_LABEL, cfg.image, "true"],
                       capture_output=True, check=True)
        swept = slots.sweep()
        results.append(check("sweep removes a crash's leftover", len(swept) == 1 and count_labelled() == 0, f"swept={len(swept)}"))

        events = [json.loads(line) for line in (pathlib.Path(tmp) / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        results.append(check("each container leaves an event", sum(e["event"] == "container-finished" for e in events) == 2))
    print(f"real-docker check: {results.count(False)} failure(s)")
    return 1 if False in results else 0


if __name__ == "__main__":
    sys.exit(main())
