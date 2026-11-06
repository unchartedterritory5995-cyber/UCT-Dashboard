#!/usr/bin/env python3
"""Run N slots of ephemeral, single-job GitHub Actions runners, one fresh container per job.

    python3 launcher.py serve --lane gate-vps --slots 3 --image sha256:<id>     # the VPS: reserved gate capacity
    python3 launcher.py serve --lane shared-vps --slots 1 --image sha256:<id>   # the VPS: dispatch and nightly
    python3 launcher.py local --image sha256:<id> -- bash -c '...'    # same container, no runner
    python3 launcher.py print-args --image sha256:<id>                # the docker argv, for review

Stdlib only, so the host needs python3 and docker and nothing else.

TOKEN APPROACH: JIT runner configs (POST /repos/{repo}/actions/runners/generate-jitconfig).
  * Each container gets a config that registers one runner for one job. There is no reusable
    registration token to steal, and the container never sees the host's credential.
  * The host credential is a fine-grained PAT limited to this one repository with
    `Administration: read and write` (the only permission that API accepts for a repo-level runner).
    It lives in a 0600 file and is read per call, so it is never in this process's argv or environ.
  * The config reaches the container on STDIN only, so it is absent from argv, `docker inspect`,
    image layers and logs. entrypoint.sh hands it to the runner.

Lanes are a closed list, and a lane decides the label. Nothing passes a free-form label. A slot carries one lane's
label only, so a job for one lane can never take the other's slot:
  gate-vps    label uct-vps-gate  reserved for the master gate's heavy jobs
  shared-vps  label uct-vps       dispatch runs and the nightly report
Both refuse to start on WSL, on non-x86_64, or beside owner/worker credentials.
The owner's PC is advisory only and uses `local`, which registers nothing: its results never appear on GitHub, so they
can neither stop nor satisfy AUDIT's merge set, and the PC needs no token.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import os
import pathlib
import platform
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

API = "https://api.github.com"
DEFAULT_REPO = "unchartedterritory5995-cyber/UCT-Dashboard"
LANE_LABELS = {"gate-vps": "uct-vps-gate", "shared-vps": "uct-vps"}
NETWORK = "uct-ci"
BRIDGE = "br-uctci"
CONTAINER_LABEL = "uct.ci=1"
LANE_KEY = "uct.ci.lane"
#: Blanked in every container, so no test can reach a paid model even if a key leaked into a default.
BLANK_ENV = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PERPLEXITY_API_KEY", "GEMINI_API_KEY",
             "GOOGLE_API_KEY", "XAI_API_KEY", "MASSIVE_API_KEY", "POLYGON_API_KEY", "FINNHUB_API_KEY")
_IMAGE_RE = re.compile(r"^(sha256:[0-9a-f]{64}|[^@\s]+@sha256:[0-9a-f]{64})$")
#: Credentials that must not exist on a gate host. The gate lane refuses to start beside any of them.
_GATE_FORBIDDEN = (".config/gh", ".claude", ".git-credentials", ".ssh/id_rsa", ".ssh/id_ed25519")


class Refused(Exception):
    """A configuration the kit will not run. The message says why."""


@dataclasses.dataclass
class Config:
    image: str
    lane: str = "gate-vps"
    repo: str = DEFAULT_REPO
    slots: int = 2
    cpus: int = 4
    memory_gib: int = 10
    pids: int = 4096
    shm_gib: int = 1
    network: str = NETWORK
    token_file: str = "~/.config/uct-ci/github-token"
    log_dir: str = "/var/log/uct-ci"
    min_free_gib: int = 30
    max_disk_gib: int = 40       # one container's writable layer. Polled, so a fast writer can overshoot by one poll.
    disk_poll_s: int = 30
    command: tuple = ("run",)    # what the container runs: the runner, unless a test says otherwise
    recycle_idle_s: int = 6 * 3600
    poll_s: int = 5
    max_job_s: int = 4 * 3600
    docker: tuple = ("docker",)
    api: str = API


def check_image(image: str) -> str:
    """The image is an immutable digest or ID. A tag can move under a job that already passed."""
    if not _IMAGE_RE.match(image or ""):
        raise Refused(f"image must be pinned by sha256 digest or ID, not a tag: {image!r}")
    return image


def check_lane(lane: str) -> str:
    if lane not in LANE_LABELS:
        raise Refused(f"unknown lane {lane!r}; lanes are {sorted(LANE_LABELS)}")
    return lane


def runner_labels(lane: str) -> list:
    return ["self-hosted", "Linux", "X64", LANE_LABELS[check_lane(lane)]]


def check_gate_host(*, machine=None, proc_version=None, home=None) -> None:
    """AUDIT's runner-trust rules, enforced where the runner starts. Only the gate lane calls this."""
    machine = machine if machine is not None else platform.machine()
    if machine not in ("x86_64", "AMD64"):
        raise Refused(f"gate lane needs x86_64, this host is {machine}")
    if proc_version is None:
        try:
            proc_version = pathlib.Path("/proc/version").read_text(encoding="utf-8")
        except OSError:
            proc_version = ""
    if "microsoft" in proc_version.lower():
        raise Refused("gate lane refuses WSL: this machine shares a host with worker sessions")
    root = pathlib.Path(home if home is not None else os.path.expanduser("~"))
    found = [p for p in _GATE_FORBIDDEN if (root / p).exists()]
    if found:
        raise Refused(f"gate lane refuses a host holding owner or worker credentials: {found}")


def container_args(cfg: Config, name: str, lane: str | None = None) -> list:
    """The one definition of a CI container: `serve` and `local` both use exactly this.

    Deliberately absent: -v, --mount, --device, --privileged, --cap-add, --pid/--ipc/--network host,
    --env-file, and any env var carrying a credential.
    """
    check_image(cfg.image)
    args = ["run", "--rm", "--interactive", "--init", "--pull=never", "--name", name,
            "--label", CONTAINER_LABEL,
            "--label", f"{LANE_KEY}={lane or cfg.lane}",
            "--hostname", name[:60],
            "--user", "1001:1001",
            "--network", cfg.network,
            "--cpus", str(cfg.cpus),
            "--memory", f"{cfg.memory_gib}g",
            "--memory-swap", f"{cfg.memory_gib}g",
            "--pids-limit", str(cfg.pids),
            "--shm-size", f"{cfg.shm_gib}g",
            "--ulimit", "nofile=65536:65536",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges"]
    for key in BLANK_ENV:
        args += ["--env", f"{key}="]
    return args


class GitHub:
    """The only code that touches the PAT. It never logs a header, a body or a config."""

    def __init__(self, cfg: Config, opener=urllib.request.urlopen):
        self.cfg, self.opener = cfg, opener

    def _token(self) -> str:
        path = pathlib.Path(os.path.expanduser(self.cfg.token_file))
        if not path.is_file():
            raise Refused(f"no token file at {path}")
        if os.name == "posix":
            mode = stat.S_IMODE(path.stat().st_mode)
            if mode & 0o077:
                raise Refused(f"{path} is mode {mode:o}; it must be 0600")
        token = path.read_text(encoding="utf-8").strip()
        if not token:
            raise Refused(f"{path} is empty")
        return token

    def _call(self, method: str, path: str, body=None):
        req = urllib.request.Request(
            f"{self.cfg.api}/repos/{self.cfg.repo}{path}", method=method,
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={"Authorization": f"Bearer {self._token()}",
                     "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28",
                     "Content-Type": "application/json"})
        with self.opener(req, timeout=30) as resp:
            raw = resp.read()
        return json.loads(raw) if raw else {}

    def jit_config(self, name: str) -> tuple:
        out = self._call("POST", "/actions/runners/generate-jitconfig", {
            "name": name, "runner_group_id": 1, "labels": runner_labels(self.cfg.lane),
            "work_folder": "../work"})
        return out["runner"]["id"], out["encoded_jit_config"]

    def busy(self, runner_id) -> bool:
        return bool(self._call("GET", f"/actions/runners/{runner_id}").get("busy"))

    def remove(self, runner_id) -> None:
        try:
            self._call("DELETE", f"/actions/runners/{runner_id}")
        except urllib.error.HTTPError as err:
            if err.code != 404:      # an ephemeral runner removes itself after its job; 404 is the good case
                raise


class Slots:
    def __init__(self, cfg: Config, github=None, clock=time.monotonic, sleep=time.sleep):
        self.cfg, self.gh, self.clock, self.sleep = cfg, github or GitHub(cfg), clock, sleep
        self.stopping = threading.Event()
        self._log_lock = threading.Lock()

    def event(self, **fields) -> None:
        """One JSON line per event: the evidence for VALIDATION-PLAN check 7. Never holds a credential."""
        line = json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **fields}, sort_keys=True)
        print(line, flush=True)
        path = pathlib.Path(self.cfg.log_dir) / "events.jsonl"
        with self._log_lock:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
            except OSError as err:
                print(f"event log unwritable: {err}", file=sys.stderr, flush=True)

    def docker(self, *args, **kw):
        return subprocess.run([*self.cfg.docker, *args], capture_output=True, text=True, **kw)

    def sweep(self) -> list:
        """Remove what a crash left, in this lane only: both lanes run side by side on the VPS, and a lane restarting
        must not kill the other's jobs."""
        out = self.docker("ps", "-aq", "--filter", f"label={LANE_KEY}={self.cfg.lane}")
        ids = out.stdout.split()
        for cid in ids:
            self.docker("rm", "-f", cid)
        return ids

    def gone(self, name: str) -> bool:
        """True once the container no longer exists, forcing removal if `--rm` did not finish it."""
        if self.docker("inspect", name).returncode != 0:
            return True
        self.docker("rm", "-f", name)
        return self.docker("inspect", name).returncode != 0

    def container_disk_gib(self, name: str) -> float:
        """The container's writable layer. Unknown reads as 0: the host-wide `disk_ok` check still stands behind it."""
        out = self.docker("inspect", "--size", "--format", "{{.SizeRw}}", name)
        try:
            return int(out.stdout.strip()) / 2**30
        except ValueError:
            return 0.0

    def disk_ok(self) -> bool:
        root = self.docker("info", "--format", "{{.DockerRootDir}}").stdout.strip() or "/"
        try:
            return shutil.disk_usage(root).free >= self.cfg.min_free_gib * 2**30
        except OSError:
            return False

    def run_once(self, slot: int) -> dict:
        name = f"uct-ci-{self.cfg.lane}-{slot}-{secrets.token_hex(4)}"
        runner_id, jit = self.gh.jit_config(name)
        log_path = pathlib.Path(self.cfg.log_dir) / f"{name}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        started = self.clock()
        with log_path.open("wb") as log:
            proc = subprocess.Popen([*self.cfg.docker, *container_args(self.cfg, name), self.cfg.image, *self.cfg.command],
                                    stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
            try:
                proc.stdin.write((jit + "\n").encode("utf-8"))
                proc.stdin.close()
            except OSError:
                pass                 # the container already died; the exit code below reports it
            del jit
            self._supervise(proc, name, runner_id, started)
        removed = self.gone(name)
        try:
            self.gh.remove(runner_id)
            deregistered = True
        except Exception as err:     # noqa: BLE001 - logged by type only: it must not end the slot
            deregistered = False
            self.event(event="deregister-failed", name=name, error=type(err).__name__)
        result = {"event": "container-finished", "slot": slot, "name": name, "exit": proc.returncode,
                  "seconds": round(self.clock() - started, 1), "removed": removed, "deregistered": deregistered}
        self.event(**result)
        return result

    def _supervise(self, proc, name, runner_id, started) -> None:
        """Recycle an idle runner so the slot does not hold a stale registration forever. A busy one is
        left to finish, up to a hard cap. A wrong call here only fails a job, it can never pass one."""
        last_disk = started
        while proc.poll() is None:
            self.sleep(self.cfg.poll_s)
            age = self.clock() - started
            if self.clock() - last_disk >= self.cfg.disk_poll_s:
                last_disk = self.clock()
                used = self.container_disk_gib(name)
                if used > self.cfg.max_disk_gib or not self.disk_ok():
                    # the job fails, which is the point: an out-of-disk host is a host every later job fails on
                    self.event(event="disk-kill", name=name, used_gib=round(used, 1), max_disk_gib=self.cfg.max_disk_gib)
                    self.docker("rm", "-f", name)
                    continue
            if self.stopping.is_set():
                self.docker("stop", "-t", "30", name)
            elif age > self.cfg.recycle_idle_s + self.cfg.max_job_s:
                self.event(event="hard-cap-kill", name=name)
                self.docker("rm", "-f", name)
            elif age > self.cfg.recycle_idle_s:
                try:
                    busy = self.gh.busy(runner_id)
                except Exception:    # noqa: BLE001 - unknown means leave it to the hard cap
                    busy = True
                if not busy:
                    self.event(event="idle-recycle", name=name)
                    self.docker("stop", "-t", "30", name)
        proc.wait()

    def slot_loop(self, slot: int) -> None:
        delay = 5
        while not self.stopping.is_set():
            if not self.disk_ok():
                self.event(event="low-disk", slot=slot, min_free_gib=self.cfg.min_free_gib)
                self.sleep(60)
                continue
            try:
                result = self.run_once(slot)
                delay = 5 if result["seconds"] > 30 else min(delay * 2, 300)
            except Refused as err:
                self.event(event="refused", slot=slot, reason=str(err))
                delay = 300
            except Exception as err:   # noqa: BLE001 - a bad token or API outage keeps the slot empty, so jobs queue
                self.event(event="slot-error", slot=slot, error=type(err).__name__)
                delay = min(delay * 2, 300)
            self.sleep(delay)

    def serve(self) -> int:
        check_lane(self.cfg.lane)
        check_image(self.cfg.image)
        check_gate_host()
        if self.docker("network", "inspect", self.cfg.network).returncode != 0:
            raise Refused(f"network {self.cfg.network} is missing; run egress-firewall.sh first")
        self.event(event="start", lane=self.cfg.lane, label=LANE_LABELS[self.cfg.lane], slots=self.cfg.slots,
                   image=self.cfg.image, swept=self.sweep())
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: self.stopping.set())
        threads = [threading.Thread(target=self.slot_loop, args=(i,), daemon=True) for i in range(self.cfg.slots)]
        for t in threads:
            t.start()
        while any(t.is_alive() for t in threads):
            self.sleep(1)
        self.event(event="stop", swept=self.sweep())
        return 0


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("serve", "local", "print-args"):
        s = sub.add_parser(name)
        s.add_argument("--image", required=True)
        s.add_argument("--lane", default="gate-vps")
        s.add_argument("--cpus", type=int, default=4)
        s.add_argument("--memory-gib", type=int, default=10)
        s.add_argument("--pids", type=int, default=4096)
        s.add_argument("--network", default=NETWORK)
        if name == "serve":
            s.add_argument("--repo", default=DEFAULT_REPO)
            s.add_argument("--slots", type=int, default=2)
            s.add_argument("--token-file", default=Config.token_file)
            s.add_argument("--log-dir", default=Config.log_dir)
            s.add_argument("--max-disk-gib", type=int, default=Config.max_disk_gib)
        if name == "local":
            s.add_argument("--name", default="")
            s.add_argument("command", nargs=argparse.REMAINDER)
    return p


def main(argv=None) -> int:
    a = _parser().parse_args(argv)
    cfg = Config(image=a.image, lane=a.lane, cpus=a.cpus, memory_gib=a.memory_gib, pids=a.pids, network=a.network)
    try:
        check_image(cfg.image)
        check_lane(cfg.lane)
        if a.cmd == "print-args":
            print(" ".join([*cfg.docker, *container_args(cfg, "uct-ci-example"), cfg.image, "run"]))
            return 0
        if a.cmd == "local":
            name = a.name or f"uct-ci-local-{secrets.token_hex(4)}"
            cmd = a.command[1:] if a.command[:1] == ["--"] else a.command
            if not cmd:
                raise Refused("local needs a command after --")
            return subprocess.call([*cfg.docker, *container_args(cfg, name, lane="local"), cfg.image, *cmd])
        cfg.repo, cfg.slots, cfg.token_file, cfg.log_dir = a.repo, a.slots, a.token_file, a.log_dir
        cfg.max_disk_gib = a.max_disk_gib
        return Slots(cfg).serve()
    except Refused as err:
        print(f"REFUSED: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
