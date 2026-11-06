"""The runner launcher's safety properties, tested with a fake Docker and a fake GitHub. No container runs here;
the real-container proofs are in infra/ci-runner/VALIDATION-PLAN.md."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import sys

import pytest

KIT = pathlib.Path(__file__).resolve().parents[1] / "infra" / "ci-runner"
_spec = importlib.util.spec_from_file_location("ci_launcher", KIT / "launcher.py")
launcher = importlib.util.module_from_spec(_spec)
sys.modules["ci_launcher"] = launcher
_spec.loader.exec_module(launcher)

IMAGE = "sha256:" + "a" * 64
JIT = "SENTINEL-JIT-" + "z" * 40

FAKE_DOCKER = r"""
import json, os, pathlib, sys
log = pathlib.Path(os.environ["FAKE_DOCKER_LOG"])
args = sys.argv[1:]
stdin = sys.stdin.read() if args[:1] == ["run"] else ""
with log.open("a", encoding="utf-8") as fh:
    fh.write(json.dumps({"argv": args, "stdin": stdin}) + "\n")
if args[:1] == ["inspect"]:
    sys.exit(1)      # the container is already gone
if args[:1] == ["info"]:
    print(os.environ.get("FAKE_DOCKER_ROOT", "."))
sys.exit(int(os.environ.get("FAKE_DOCKER_RUN_EXIT", "0")) if args[:1] == ["run"] else 0)
"""


class FakeGitHub:
    def __init__(self):
        self.removed = []

    def jit_config(self, name):
        return 77, JIT

    def busy(self, runner_id):
        return False

    def remove(self, runner_id):
        self.removed.append(runner_id)


@pytest.fixture
def rig(tmp_path, monkeypatch):
    fake = tmp_path / "fake_docker.py"
    fake.write_text(FAKE_DOCKER, encoding="utf-8")
    log = tmp_path / "docker.jsonl"
    monkeypatch.setenv("FAKE_DOCKER_LOG", str(log))
    cfg = launcher.Config(image=IMAGE, docker=(sys.executable, str(fake)), log_dir=str(tmp_path / "logs"), min_free_gib=0)
    gh = FakeGitHub()
    slots = launcher.Slots(cfg, github=gh, sleep=lambda s: None)

    def calls():
        return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]

    return slots, gh, calls, tmp_path


# ---- the container definition

def test_the_container_has_every_limit_and_drops_everything():
    args = launcher.container_args(launcher.Config(image=IMAGE, cpus=4, memory_gib=10, pids=4096), "x")
    pairs = dict(zip(args, args[1:]))
    assert "--rm" in args
    assert pairs["--user"] == "1001:1001"
    assert pairs["--cpus"] == "4"
    assert pairs["--memory"] == "10g" and pairs["--memory-swap"] == "10g"    # equal means no swap
    assert pairs["--pids-limit"] == "4096"
    assert pairs["--cap-drop"] == "ALL"
    assert pairs["--security-opt"] == "no-new-privileges"
    assert pairs["--network"] == "uct-ci"
    assert "--pull=never" in args


@pytest.mark.parametrize("banned", ["-v", "--volume", "--mount", "--device", "--privileged", "--cap-add", "--env-file",
                                    "--pid", "--ipc", "--volumes-from", "--group-add"])
def test_nothing_in_the_container_definition_reaches_the_host(banned):
    args = launcher.container_args(launcher.Config(image=IMAGE), "x")
    assert not [a for a in args if a == banned or a.startswith(banned + "=")], args


def test_no_docker_socket_or_host_network_anywhere():
    text = " ".join(launcher.container_args(launcher.Config(image=IMAGE), "x"))
    assert "docker.sock" not in text and "host" not in text.replace("--hostname", "")


def test_every_api_key_is_blank_in_the_container():
    args = launcher.container_args(launcher.Config(image=IMAGE), "x")
    envs = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
    assert "ANTHROPIC_API_KEY=" in envs and "PERPLEXITY_API_KEY=" in envs
    assert all(e.endswith("=") for e in envs), envs


# ---- image, lane and host refusals

@pytest.mark.parametrize("image", ["uct-ci-runner:latest", "uct-ci-runner", "ubuntu:26.04", "", "sha256:abc",
                                   "x@sha256:short", "sha256:" + "A" * 64])
def test_a_tag_or_malformed_digest_is_refused(image):
    with pytest.raises(launcher.Refused):
        launcher.container_args(launcher.Config(image=image), "x")


@pytest.mark.parametrize("image", [IMAGE, "registry.example/uct-ci@sha256:" + "b" * 64])
def test_a_digest_is_accepted(image):
    assert launcher.check_image(image) == image


def test_lanes_are_a_closed_list_and_the_lane_picks_the_label():
    assert launcher.runner_labels("gate-vps")[-1] == "uct-vps-gate"
    assert launcher.runner_labels("shared-vps")[-1] == "uct-vps"
    assert "ubuntu-latest" not in launcher.runner_labels("gate-vps")
    assert set(launcher.LANE_LABELS) == {"gate-vps", "shared-vps"}     # the PC has no lane: it registers nothing


def test_a_slot_carries_one_lanes_label_so_gate_capacity_stays_reserved():
    """GitHub matches a job to a runner holding ALL of its labels, so `uct-vps` jobs must not fit a gate slot."""
    gate, shared = set(launcher.runner_labels("gate-vps")), set(launcher.runner_labels("shared-vps"))
    assert "uct-vps" not in gate and "uct-vps-gate" not in shared
    for lane in ("uct-vps", "advisory-pc"):
        with pytest.raises(launcher.Refused):
            launcher.runner_labels(lane)


def test_serving_refuses_a_shared_host_before_it_touches_github(monkeypatch):
    monkeypatch.setattr(launcher, "check_gate_host", lambda: (_ for _ in ()).throw(launcher.Refused("WSL")))
    with pytest.raises(launcher.Refused):
        launcher.Slots(launcher.Config(image=IMAGE), github=FakeGitHub()).serve()


def test_the_gate_lane_refuses_wsl(tmp_path):
    with pytest.raises(launcher.Refused, match="WSL"):
        launcher.check_gate_host(machine="x86_64", proc_version="Linux 6.18.54.1-microsoft-standard-WSL2", home=tmp_path)


def test_the_gate_lane_refuses_arm(tmp_path):
    with pytest.raises(launcher.Refused, match="x86_64"):
        launcher.check_gate_host(machine="aarch64", proc_version="Linux", home=tmp_path)


@pytest.mark.parametrize("cred", [".config/gh", ".claude", ".git-credentials", ".ssh/id_ed25519"])
def test_the_gate_lane_refuses_a_host_holding_credentials(tmp_path, cred):
    p = tmp_path / cred
    p.parent.mkdir(parents=True, exist_ok=True)
    p.mkdir()
    with pytest.raises(launcher.Refused, match="credentials"):
        launcher.check_gate_host(machine="x86_64", proc_version="Linux", home=tmp_path)


def test_a_clean_x64_host_passes_the_gate_lane_check(tmp_path):
    launcher.check_gate_host(machine="x86_64", proc_version="Linux version 6.8 generic", home=tmp_path)


# ---- the token path

def test_the_jit_config_goes_over_stdin_and_nowhere_else(rig):
    slots, gh, calls, tmp = rig
    result = slots.run_once(0)
    assert result["exit"] == 0
    runs = [c for c in calls() if c["argv"][:1] == ["run"]]
    assert len(runs) == 1
    assert runs[0]["stdin"].strip() == JIT
    assert JIT not in " ".join(runs[0]["argv"])
    for c in calls():
        assert JIT not in " ".join(c["argv"])
    for path in pathlib.Path(slots.cfg.log_dir).iterdir():       # events and per-container logs
        assert JIT not in path.read_text(encoding="utf-8")


def test_each_job_gets_a_fresh_container_and_is_verified_gone(rig):
    slots, gh, calls, tmp = rig
    first, second = slots.run_once(0), slots.run_once(0)
    assert first["name"] != second["name"]
    assert first["removed"] and second["removed"] and first["deregistered"]
    assert gh.removed == [77, 77]
    assert [c["argv"][0] for c in calls()].count("inspect") >= 2


def test_a_sweep_is_limited_to_its_own_lane(rig):
    slots, gh, calls, tmp = rig
    slots.sweep()
    assert ["ps", "-aq", "--filter", "label=uct.ci.lane=gate-vps"] in [c["argv"] for c in calls()]


def test_a_container_is_labelled_with_its_lane():
    args = launcher.container_args(launcher.Config(image=IMAGE, lane="shared-vps"), "x")
    assert "uct.ci.lane=shared-vps" in args


class SlowProc:
    """A running container, as _supervise sees it, for a fixed number of polls."""

    def __init__(self, polls):
        self.polls, self.returncode = polls, None

    def poll(self):
        self.polls -= 1
        if self.polls < 0:
            self.returncode = 137
        return self.returncode

    def wait(self):
        return self.returncode


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


def _supervised(tmp_path, used_gib, free_ok=True):
    clock = FakeClock()
    cfg = launcher.Config(image=IMAGE, log_dir=str(tmp_path / "l"), max_disk_gib=40, poll_s=5, disk_poll_s=30)
    slots = launcher.Slots(cfg, github=FakeGitHub(), clock=clock, sleep=clock.sleep)
    killed = []
    slots.docker = lambda *a, **k: killed.append(a)
    slots.container_disk_gib = lambda name: used_gib
    slots.disk_ok = lambda: free_ok
    slots._supervise(SlowProc(10), "c", 1, clock())
    return killed


def test_a_container_over_its_disk_bound_is_killed(tmp_path):
    assert ("rm", "-f", "c") in _supervised(tmp_path, used_gib=41)


def test_a_low_host_kills_the_container_even_under_its_own_bound(tmp_path):
    assert ("rm", "-f", "c") in _supervised(tmp_path, used_gib=1, free_ok=False)


def test_a_container_within_its_bound_is_left_alone(tmp_path):
    assert _supervised(tmp_path, used_gib=39) == []


def test_a_failing_container_reports_its_exit_code(rig, monkeypatch):
    slots, gh, calls, tmp = rig
    monkeypatch.setenv("FAKE_DOCKER_RUN_EXIT", "137")
    assert slots.run_once(0)["exit"] == 137


def test_the_token_file_must_be_private(tmp_path):
    if sys.platform == "win32":
        pytest.skip("POSIX mode bits only")
    f = tmp_path / "t"
    f.write_text("x", encoding="utf-8")
    f.chmod(0o644)
    with pytest.raises(launcher.Refused, match="0600"):
        launcher.GitHub(launcher.Config(image=IMAGE, token_file=str(f)))._token()


def test_a_missing_or_empty_token_file_refuses(tmp_path):
    with pytest.raises(launcher.Refused):
        launcher.GitHub(launcher.Config(image=IMAGE, token_file=str(tmp_path / "none")))._token()
    f = tmp_path / "empty"
    f.write_text("  \n", encoding="utf-8")
    f.chmod(0o600)
    with pytest.raises(launcher.Refused):
        launcher.GitHub(launcher.Config(image=IMAGE, token_file=str(f)))._token()


def test_the_api_call_carries_the_token_only_in_a_header(tmp_path):
    f = tmp_path / "t"
    f.write_text("TOKENVALUE", encoding="utf-8")
    f.chmod(0o600)
    seen = []

    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps({"runner": {"id": 5}, "encoded_jit_config": "abc"}).encode()

    def opener(req, timeout):
        seen.append(req)
        return Resp()

    cfg = launcher.Config(image=IMAGE, token_file=str(f), repo="o/r")
    assert launcher.GitHub(cfg, opener=opener).jit_config("n") == (5, "abc")
    req = seen[0]
    assert req.full_url == "https://api.github.com/repos/o/r/actions/runners/generate-jitconfig"
    assert req.get_header("Authorization") == "Bearer TOKENVALUE"
    body = json.loads(req.data)
    assert "TOKENVALUE" not in req.full_url and "TOKENVALUE" not in req.data.decode()
    assert body["labels"][-1] == "uct-vps-gate" and body["runner_group_id"] == 1


# ---- the sudo shim and the entrypoint are shell, so run them

def _bash():
    import shutil
    b = shutil.which("bash")
    if not b or sys.platform == "win32":
        pytest.skip("needs a POSIX shell; the real image proof is in VALIDATION-PLAN check 7")
    return b


@pytest.mark.parametrize("args", [["id"], ["rm", "-rf", "/"], ["chown", "0:0", "/data"], ["mkdir", "-p", "/data", "/etc"]])
def test_the_sudo_shim_refuses_everything_but_the_data_setup(args):
    r = subprocess.run([_bash(), str(KIT / "sudo-shim.sh"), *args], capture_output=True, text=True)
    assert r.returncode == 1 and "refused" in r.stderr


def test_the_entrypoint_refuses_to_start_without_a_config():
    r = subprocess.run([_bash(), str(KIT / "entrypoint.sh"), "run"], input="", capture_output=True, text=True)
    assert r.returncode == 64


def test_the_sudo_shim_grants_no_privilege_by_construction():
    text = (KIT / "sudo-shim.sh").read_text(encoding="utf-8")
    code = "\n".join(line for line in text.splitlines() if not line.startswith("#"))
    assert 'exec "$@"' not in code and "eval" not in code


def test_the_image_pins_the_base_by_digest_and_ships_no_real_sudo():
    text = (KIT / "Dockerfile").read_text(encoding="utf-8")
    from_lines = [line for line in text.splitlines() if line.startswith("FROM ")]
    assert len(from_lines) == 1 and "@sha256:" in from_lines[0]
    packages = text.split("apt-get install", 1)[1].split("rm -rf", 1)[0]
    assert " sudo " not in packages.replace("\\\n", " ")
    assert "USER 1001:1001" in text
    for name in ("RUNNER_SHA256", "NODE_SHA256", "PYTHON_SHA256"):
        assert f"ARG {name}=" in text and f"${{{name}}}" in text
