"""`tools/railway_stored_settings.py`: Railway's stored settings must equal the config files.

On 2026-12-01 Railway stops reading `railway.json` / `railway.toml`; from then a service runs on
what Railway has stored for it. These tests need no Railway. They pin:

  * the comparison (what counts as "the same", and that each kind of difference is reported);
  * the update the tool would store for a config file;
  * that EVERY key in the repo's real config files is one the tool can store. This is the rail
    that matters day to day: add a key to `railway.web.json` that the tool does not know, and
    this fails, instead of the key being merged and never reaching Railway.

Mutation proof (run before calling these done):
    1. `differences` ignores watchPatterns            -> test_each_kind_of_difference_is_reported RED
    2. `stored_replicas` returns the first region only -> test_replicas_are_counted_across_regions RED
    3. `to_update` writes builder "DOCKERFILE"         -> test_a_dockerfile_build_is_stored_as_its_path RED
    4. `to_update` skips unknown keys silently         -> test_a_setting_the_tool_cannot_store_is_refused RED
    5. "flow-worker" removed from SERVICES             -> test_the_three_services_built_from_a_file_are_listed RED

The per-service selector (`--service`, 2026-11-19). Mutation proof:
    6. `apply` with no service falls through to every service (refusal removed)
                                                      -> test_apply_without_a_service_refuses_before_touching_railway RED
    7. `apply` loops over SERVICES instead of the chosen ones
                                                      -> test_apply_writes_only_the_named_services RED
    8. `check` loops over SERVICES instead of the chosen ones
                                                      -> test_check_covers_only_the_named_services RED
    9. `selected` drops an unknown name instead of refusing it
                                                      -> test_an_unknown_service_is_refused_not_passed RED
   10. `main` drops `--service` on the way to `apply` -> test_the_command_line_passes_the_services_through RED
"""
from __future__ import annotations

import copy
import json
import os

import pytest

from tools import railway_stored_settings as rss

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WEB_FILE = {
    "$schema": "https://railway.app/railway.schema.json",
    "build": {"builder": "DOCKERFILE", "dockerfilePath": "Dockerfile.web",
              "watchPatterns": ["api/**", "app/**", "Dockerfile.web"]},
    "deploy": {"numReplicas": 1, "drainingSeconds": 30, "healthcheckPath": "/api/health",
               "healthcheckTimeout": 600, "restartPolicyType": "ALWAYS"},
}
#: What Railway returns for a service whose stored settings match WEB_FILE (shape measured 2026-11-14).
WEB_STORED = {
    "build": {"buildEnvironment": "V3", "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile.web",
              "watchPatterns": ["app/**", "Dockerfile.web", "api/**"]},
    "deploy": {"drainingSeconds": 30, "healthcheckPath": "/api/health", "healthcheckTimeout": 600,
               "ipv6EgressEnabled": False, "multiRegionConfig": {"us-east4-eqdc4a": {"numReplicas": 1}},
               "restartPolicyType": "ALWAYS", "runtime": "V2", "startCommand": "", "useLegacyStacker": False},
}
WORKER_FILE = {
    "build": {"builder": "NIXPACKS", "buildCommand": "pip install -r requirements.txt"},
    "deploy": {"startCommand": "exec python -m api.worker_main", "drainingSeconds": 30,
               "healthcheckPath": "/api/health", "healthcheckTimeout": 600, "restartPolicyType": "ALWAYS"},
}


# ── the comparison ────────────────────────────────────────────────────────────

def test_matching_settings_report_no_difference():
    """Watch paths in another order, and settings Railway stores that the file never mentions
    (runtime, IPv6, the per-region layout), are not differences."""
    assert rss.differences(WEB_FILE, WEB_STORED) == []


@pytest.mark.parametrize("section,key,value", [
    ("build", "builder", "RAILPACK"),
    ("build", "dockerfilePath", None),
    ("build", "watchPatterns", ["api/**", "app/**"]),
    ("build", "watchPatterns", []),
    ("deploy", "healthcheckPath", None),
    ("deploy", "healthcheckPath", "/internal/health"),
    ("deploy", "healthcheckTimeout", 300),
    ("deploy", "restartPolicyType", "ON_FAILURE"),
    ("deploy", "drainingSeconds", None),
])
def test_each_kind_of_difference_is_reported(section, key, value):
    stored = copy.deepcopy(WEB_STORED)
    stored[section][key] = value
    found = rss.differences(WEB_FILE, stored)
    assert len(found) == 1 and found[0].startswith(f"{section}.{key}:"), found


def test_a_service_with_nothing_stored_differs_on_every_file_setting():
    """flow-worker on 2026-11-14: no start command, no health check, nothing."""
    found = rss.differences(WORKER_FILE, {"build": {"builder": "RAILPACK"}, "deploy": {}})
    assert len(found) == 7 and any(line.startswith("deploy.startCommand:") and "nothing" in line for line in found)


def test_replicas_are_counted_across_regions():
    stored = copy.deepcopy(WEB_STORED)
    assert rss.stored_replicas(stored["deploy"]) == 1
    stored["deploy"]["multiRegionConfig"] = {"us-east4-eqdc4a": {"numReplicas": 1}, "europe-west4": {"numReplicas": 1}}
    assert rss.stored_replicas(stored["deploy"]) == 2
    assert [d for d in rss.differences(WEB_FILE, stored) if d.startswith("deploy.numReplicas:")]


# ── the update ────────────────────────────────────────────────────────────────

def test_a_dockerfile_build_is_stored_as_its_path():
    """Railway's update call has no builder named DOCKERFILE: a stored Dockerfile path selects it."""
    update = rss.to_update(WEB_FILE)
    assert "builder" not in update and update["dockerfilePath"] == "Dockerfile.web"
    assert update == {"dockerfilePath": "Dockerfile.web", "watchPatterns": ["api/**", "app/**", "Dockerfile.web"],
                      "drainingSeconds": 30, "healthcheckPath": "/api/health", "healthcheckTimeout": 600,
                      "restartPolicyType": "ALWAYS"}


def test_a_named_builder_and_the_start_command_are_stored():
    update = rss.to_update(WORKER_FILE)
    assert update["builder"] == "NIXPACKS"
    assert update["startCommand"] == "exec python -m api.worker_main"
    assert update["buildCommand"] == "pip install -r requirements.txt"


@pytest.mark.parametrize("config", [
    {"deploy": {"somethingRailwayAddsNextYear": 1}},
    {"build": {"builder": "DOCKERFILE"}},                 # a Dockerfile build with no path
    {"build": {"builder": "BUILDPACKS"}},
    {"environments": {"production": {}}},
])
def test_a_setting_the_tool_cannot_store_is_refused(config):
    with pytest.raises(rss.UnknownSetting):
        rss.to_update(config)


# ── the repo's real files ─────────────────────────────────────────────────────

def test_the_three_services_built_from_a_file_are_listed():
    assert rss.SERVICES == {"web": "railway.web.json", "worker": "railway.json", "flow-worker": "railway.json",
                            "stream-ingest": "railway.ingest.json", "stream-edge": "railway.edge.json"}


@pytest.mark.parametrize("service,name", sorted(rss.SERVICES.items()))
def test_every_setting_in_the_real_config_files_can_be_stored(service, name):
    config = rss.load_config(name, ROOT)
    update = rss.to_update(config)                        # raises UnknownSetting on a key with no stored field
    assert update, f"{name} produced an empty update: the reader has gone blind"
    supplied = {(s, k) for s in ("build", "deploy") for k in (config.get(s) or {})}
    covered = {pair for pair, field in rss.STORED_FIELD.items() if field in update}
    covered |= {("build", "builder"), ("deploy", "numReplicas")} & supplied
    assert supplied == covered, f"{name}: supplied by the file but not carried: {sorted(supplied - covered)}"


def test_the_worker_services_keep_a_start_command_and_the_main_server_keeps_its_dockerfile():
    """The two losses that would have hurt most on the day Railway stops reading these files."""
    assert "exec python -m api.flow_worker_main" in rss.to_update(rss.load_config("railway.json", ROOT))["startCommand"]
    assert rss.to_update(rss.load_config("railway.web.json", ROOT))["dockerfilePath"] == "Dockerfile.web"


# ── the tool's own answers ────────────────────────────────────────────────────

def test_self_check_passes():
    lines = []
    assert rss.self_check(lines.append) == 0, lines


def _patched(monkeypatch, stored):
    monkeypatch.setattr(rss, "read_stored", lambda cwd=None: stored)


def _real_stored() -> dict:
    """Stored settings that match the repo's real files, built the way Railway returns them."""
    out = {}
    for service, name in rss.SERVICES.items():
        config = rss.load_config(name, ROOT)
        deploy = dict(config.get("deploy") or {})
        replicas = deploy.pop("numReplicas", 1)
        deploy["multiRegionConfig"] = {"us-east4-eqdc4a": {"numReplicas": replicas}}
        out[service] = {"build": dict(config.get("build") or {}), "deploy": deploy}
    return out


def test_check_exits_0_same_1_different_2_could_not_tell(monkeypatch):
    lines = []
    _patched(monkeypatch, _real_stored())
    assert rss.check(lines.append, root=ROOT) == 0

    drifted = _real_stored()
    drifted["flow-worker"]["deploy"]["startCommand"] = ""
    _patched(monkeypatch, drifted)
    lines.clear()
    assert rss.check(lines.append, root=ROOT) == 1
    assert any("deploy.startCommand" in line for line in lines)

    def unreachable(cwd=None):
        raise rss.Inconclusive("this Railway CLI is too old")
    monkeypatch.setattr(rss, "read_stored", unreachable)
    lines.clear()
    assert rss.check(lines.append, root=ROOT) == 2 and lines[0].startswith("INCONCLUSIVE")

    missing = _real_stored()
    del missing["worker"]
    _patched(monkeypatch, missing)
    assert rss.check(lambda *_: None, root=ROOT) == 2     # a missing service is "could not tell", never "same"


def test_apply_stores_only_what_differs_and_then_checks(monkeypatch):
    state = _real_stored()
    state["worker"]["deploy"]["healthcheckPath"] = "/internal/health"
    sent = []
    monkeypatch.setattr(rss, "read_stored", lambda cwd=None: copy.deepcopy(state))
    monkeypatch.setattr(rss, "service_ids", lambda cwd=None: ({"web": "w", "worker": "k", "flow-worker": "f"}, "env"))

    def store(service_id, environment_id, update, cwd=None):
        sent.append((service_id, environment_id, json.loads(json.dumps(update))))
        state["worker"]["deploy"]["healthcheckPath"] = update["healthcheckPath"]
    monkeypatch.setattr(rss, "store", store)

    lines = []
    assert rss.apply(lines.append, root=ROOT, services=["web", "worker", "flow-worker"]) == 0
    assert [(s, e) for s, e, _ in sent] == [("k", "env")], "only the service that differed is written"
    assert sent[0][2]["healthcheckPath"] == "/api/health"
    assert any("do not deploy" in line for line in lines)


# ── the per-service selector ──────────────────────────────────────────────────

def _no_railway(monkeypatch):
    """Every Railway door raises: a test using this proves nothing reached Railway."""
    def forbidden(*_a, **_k):
        raise AssertionError("Railway was called")
    for name in ("read_stored", "service_ids", "store"):
        monkeypatch.setattr(rss, name, forbidden)


@pytest.mark.parametrize("services", [None, []])
def test_apply_without_a_service_refuses_before_touching_railway(monkeypatch, services):
    """A bare `--apply` would write every differing service, including two (stream-ingest,
    stream-edge) whose intended builder nobody has decided. It must refuse, and refuse first."""
    _no_railway(monkeypatch)
    lines = []
    assert rss.apply(lines.append, root=ROOT, services=services) == 2
    assert lines and lines[0].startswith("REFUSED") and "--service" in lines[0]


def test_apply_writes_only_the_named_services(monkeypatch):
    state = _real_stored()
    state["worker"]["deploy"]["healthcheckPath"] = "/internal/health"
    state["stream-edge"]["build"]["builder"] = "RAILPACK"          # differs too, but is not named
    sent = []
    monkeypatch.setattr(rss, "read_stored", lambda cwd=None: copy.deepcopy(state))
    monkeypatch.setattr(rss, "service_ids", lambda cwd=None: (
        {"web": "w", "worker": "k", "flow-worker": "f", "stream-ingest": "i", "stream-edge": "e"}, "env"))

    def store(service_id, environment_id, update, cwd=None):
        sent.append(service_id)
        state["worker"]["deploy"]["healthcheckPath"] = update["healthcheckPath"]
    monkeypatch.setattr(rss, "store", store)

    lines = []
    assert rss.apply(lines.append, root=ROOT, services=["worker"]) == 0, lines
    assert sent == ["k"], "a service that was not named is never written, even when it differs"
    assert not any("stream-edge" in line for line in lines), "the closing check covers the named service only"


def test_check_covers_only_the_named_services(monkeypatch):
    drifted = _real_stored()
    drifted["flow-worker"]["deploy"]["startCommand"] = ""
    _patched(monkeypatch, drifted)
    lines = []
    assert rss.check(lines.append, root=ROOT, services=["web"]) == 0
    assert [line for line in lines if "flow-worker" in line] == []
    assert lines[-1].endswith("(only web)")
    lines.clear()
    assert rss.check(lines.append, root=ROOT, services=["web", "flow-worker", "web"]) == 1
    assert sum(1 for line in lines if line.split()[1:2] == ["web"]) == 1, "a repeated name is compared once"
    assert rss.check(lambda *_: None, root=ROOT) == 1, "no --service still compares every service"


def test_an_unknown_service_is_refused_not_passed(monkeypatch):
    """A typo must never read as "nothing differs"."""
    _no_railway(monkeypatch)
    with pytest.raises(ValueError):
        rss.selected(["webb"])
    lines = []
    assert rss.check(lines.append, root=ROOT, services=["webb"]) == 2 and lines[0].startswith("REFUSED")
    assert rss.apply(lines.append, root=ROOT, services=["web", "webb"]) == 2
    assert list(rss.selected(["stream-edge", "web"])) == ["web", "stream-edge"], "SERVICES order, not argument order"


def test_the_command_line_passes_the_services_through(monkeypatch):
    calls = []
    monkeypatch.setattr(rss, "check", lambda services=None, **_: calls.append(("check", services)) or 0)
    monkeypatch.setattr(rss, "apply", lambda services=None, **_: calls.append(("apply", services)) or 0)
    rss.main(["--service", "web", "--service", "stream-edge"])
    rss.main(["--apply", "--service", "worker"])
    rss.main([])
    assert calls == [("check", ["web", "stream-edge"]), ("apply", ["worker"]), ("check", None)]
    with pytest.raises(SystemExit) as exc:
        rss.main(["--service", "nope"])
    assert exc.value.code == 2


def test_a_bare_apply_on_the_command_line_refuses(monkeypatch):
    """Through `main`, with every Railway door patched to raise: nothing real is ever called."""
    _no_railway(monkeypatch)
    assert rss.main(["--apply"]) == 2
