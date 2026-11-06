#!/usr/bin/env python3
"""Exercises launcher.py against REAL Docker with a stub in place of GitHub. Registers nothing, needs no token.

    python3 launcher_real_docker_check.py <image>

Proves, with real containers: a slot starts a container, feeds it a config on stdin, sees it exit, verifies it is
gone and logs that; a killed container reports a failing exit code and is gone; `sweep` removes what a crash left, and
only in its own lane; a container that fills its disk past the bound is killed and its space comes back.
The config is deliberately invalid, so the runner exits at once. It never contacts GitHub.
"""
from __future__ import annotations

import base64
import json
import pathlib
import shutil
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


def host_free_gib() -> float:
    root = subprocess.run(["docker", "info", "--format", "{{.DockerRootDir}}"], capture_output=True, text=True).stdout.strip()
    return shutil.disk_usage(root).free / 2**30


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
        subprocess.run(["docker", "create", "--name", "uct-ci-leftover", "--label", launcher.CONTAINER_LABEL, "--label",
                        f"{launcher.LANE_KEY}={cfg.lane}", cfg.image, "true"],
                       capture_output=True, check=True)
        swept = slots.sweep()
        results.append(check("sweep removes a crash's leftover", len(swept) == 1 and count_labelled() == 0, f"swept={len(swept)}"))

        # A second lane's container survives this lane's sweep: the two lanes share one host.
        subprocess.run(["docker", "create", "--name", "uct-ci-other-lane", "--label", launcher.CONTAINER_LABEL, "--label",
                        f"{launcher.LANE_KEY}=shared-vps", cfg.image, "true"], capture_output=True, check=True)
        swept = slots.sweep()
        survived = subprocess.run(["docker", "inspect", "uct-ci-other-lane"], capture_output=True).returncode == 0
        subprocess.run(["docker", "rm", "-f", "uct-ci-other-lane"], capture_output=True)
        results.append(check("a sweep leaves the other lane alone", survived and not swept))

        # Real fill: write far past a 2 GiB bound with incompressible data. Poll fast so the test is quick.
        before = host_free_gib()
        fill = launcher.Config(image=image, log_dir=tmp, min_free_gib=1, max_disk_gib=2, poll_s=1, disk_poll_s=2, recycle_idle_s=600,
                               command=("bash", "-c", "cat > /dev/null; for i in $(seq 1 60); do "
                                        "head -c 200M /dev/urandom > /home/runner/fill-$i || exit 1; sleep 1; done; echo FILLED-ALL"))
        filler = launcher.Slots(fill, github=gh)
        result = filler.run_once(9)
        results.append(check("a container past its disk bound is killed", result["exit"] not in (0, None), f"exit={result['exit']} seconds={result['seconds']}"))
        log = (pathlib.Path(tmp) / f"{result['name']}.log").read_text(encoding="utf-8", errors="replace")
        results.append(check("it never finished writing", "FILLED-ALL" not in log))
        results.append(check("the killed container is gone", result["removed"]))
        results.append(check("its disk came back", host_free_gib() >= before - 0.5, f"free {before:.1f} -> {host_free_gib():.1f} GiB"))

        events = [json.loads(line) for line in (pathlib.Path(tmp) / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        results.append(check("each container leaves an event", sum(e["event"] == "container-finished" for e in events) == 3))
        disk = [e for e in events if e["event"] == "disk-kill"]
        results.append(check("the kill is logged with its size", len(disk) == 1 and disk[0]["used_gib"] >= 2, str(disk[0].get("used_gib") if disk else None)))
    print(f"real-docker check: {results.count(False)} failure(s)")
    return 1 if False in results else 0


if __name__ == "__main__":
    sys.exit(main())
