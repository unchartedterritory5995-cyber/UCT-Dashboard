"""Market Cap V1 refresh orchestration: failure atomicity (the authority never moves unless everything succeeded),
checkpoint resume, singleton lock, HOLD, heartbeat, and the automated-advance policy. Stage bodies are stubbed;
publication / verification / pointer moves are the real ones over a LocalTarget."""
from __future__ import annotations

import json
import os

import pytest

from api.services.marketcap import publication as P, refresh as RF, release_contract as C

from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation

B0 = "MCAP_V1-20261001T050000Z"


@pytest.fixture
def root(tmp_path, monkeypatch):
    r = tmp_path / "root"
    r.mkdir()
    bucket = tmp_path / "bucket"
    (r / "refresh.json").write_text(json.dumps({"target": f"local:{bucket}", "policy": {"auto_advance": False}}))
    prices = make_prices(str(tmp_path / "prices.db"))
    monkeypatch.setattr(RF.M, "drift", lambda *a, **k: {})
    state = {"n": 0, "fail": None, "gates": "PASS", "calls": []}

    def fake(self_):
        tp = tmp_path

        def stage_fn(name):
            def f(*a, **k):
                state["calls"].append(name)
                if state["fail"] == name:
                    raise RuntimeError(f"injected failure in {name}")
                return {"ok": True}
            return f
        self_.sources = stage_fn("sources")
        self_.sec = lambda: (state["calls"].append("sec_bulk") or {
            "companyfacts.zip": {"path": "cf", "sha256": "a" * 64}, "submissions.zip": {"path": "sub", "sha256": "b" * 64}})
        def cmd(args, log):
            name = args[2].split(".")[-1]
            state["calls"].append(name)
            if state["fail"] == name:
                raise RuntimeError(f"injected failure in {name}")
            return {"rc": 0}
        self_.cmd = cmd
        for n in ("_acceptance", "_harvests", "_suite", "_identity"):
            setattr(self_, n, stage_fn(n.strip("_")))
        self_._lineage = lambda sub: stage_fn("lineage")()
        self_._predecessors = lambda cf, sub: stage_fn("predecessors")()

        def build(log):
            state["calls"].append("build")
            if state["fail"] == "build":
                raise RuntimeError("injected build failure")
            state["n"] += 1
            bid = f"MCAP_V1-2026100{2 + state['n']}T050000Z"
            p = make_build(str(tp / f"{bid}.db"), bid, last_day=20261001)
            return {"build_path": p, "build_id": bid}
        self_._build = build
        self_._dependent = lambda bp: {"changed": False}
        self_._seal = lambda bp: {"db_sha256": P.file_sha(bp)[0], "db_bytes": 1, "inputs": {}}

        def gates(bp):
            v = passing_validation() if state["gates"] == "PASS" else {"status": "FAIL", "gates": {"C": {"pass": False}}}
            v["failed"] = [] if state["gates"] == "PASS" else ["C"]
            json.dump(v, open(os.path.join(self_.rdir, "validation.json"), "w"))
            return {"status": v["status"], "failed": v["failed"]}
        self_._gates = gates
        self_.manifest_fields = lambda bp, build, src, sec: manifest_fields(build["build_id"], P.file_sha(bp)[0])

        real_publish = self_._publish

        def publish(bp, build, src, sec):
            if state["fail"] == "publish":
                raise OSError("injected upload failure")
            os.makedirs(self_.rdir, exist_ok=True)
            return P.publish_build(self_.cfg.target(), build_db=bp, prices_db=prices,
                                   manifest_fields=self_.manifest_fields(bp, build, src, sec),
                                   validation=json.load(open(os.path.join(self_.rdir, "validation.json"))))
        self_._publish = publish
        assert real_publish
        return self_

    def make(run_id=None):
        r_ = RF.Refresh(str(r), run_id)
        os.makedirs(r_.rdir, exist_ok=True)
        os.makedirs(r_.logs, exist_ok=True)
        return fake(r_)
    t = P.LocalTarget(str(bucket))
    # an existing human-accepted authority A0
    a0 = make_build(str(tmp_path / "a0.db"), B0, last_day=20260930)
    pa0 = P.publish_build(t, build_db=a0, prices_db=prices, manifest_fields=manifest_fields(B0, P.file_sha(a0)[0], latest="2026-09-30",
                                                                                          cutoff="2026-09-30T23:00:00Z"),
                          validation=passing_validation())
    P.advance(t, B0, pa0["manifest_sha256"], expect_current=None, by="owner", reason="cutover", acceptance="HUMAN_CUTOVER")
    return {"root": str(r), "make": make, "state": state, "t": t}


def authority(env):
    return P.read_pointer(env["t"])["build_id"]


def status(env):
    return json.load(open(os.path.join(env["root"], "status.json")))


def test_G_success_publishes_but_does_not_advance_without_policy(root):
    res = root["make"]().execute()
    assert res["state"] == "PUBLISHED_NOT_ADVANCED" and authority(root) == B0, res
    assert root["t"].exists(C.manifest_key(res["build_id"]))
    assert "auto_advance is off" in res["advance"]["why"]
    st = status(root)
    assert st["in_progress"] is False and st["last_run"]["state"] == "PUBLISHED_NOT_ADVANCED"


def test_success_with_policy_advances_from_a_human_rooted_authority(root):
    cfgp = os.path.join(root["root"], "refresh.json")
    cfg = json.load(open(cfgp))
    cfg["policy"]["auto_advance"] = True
    json.dump(cfg, open(cfgp, "w"))
    res = root["make"]().execute()
    assert res["state"] == "ADVANCED" and authority(root) == res["build_id"]
    p = P.read_pointer(root["t"])
    assert p["acceptance"] == "AUTOMATED_REFRESH" and p["human_rooted"] is True and p["previous"]["build_id"] == B0


def test_first_authority_is_never_automated(root):
    os.remove(os.path.join(root["t"].root, *C.AUTHORITY_KEY.split("/")))
    cfgp = os.path.join(root["root"], "refresh.json")
    cfg = json.load(open(cfgp))
    cfg["policy"]["auto_advance"] = True
    json.dump(cfg, open(cfgp, "w"))
    res = root["make"]().execute()
    assert res["state"] == "PUBLISHED_NOT_ADVANCED" and any("human cutover" in w for w in res["advance"]["why"])
    assert P.read_pointer(root["t"]) is None


def test_A_build_failure_keeps_authority_and_is_visible(root):
    root["state"]["fail"] = "build"
    res = root["make"]().execute()
    assert res["state"] == "FAILED" and res["stage"] == "build_1"
    assert authority(root) == B0
    st = status(root)
    assert st["last_run"]["state"] == "FAILED" and "build_1" in st["last_run"]["error"]


def test_B_gates_failure_publishes_nothing(root):
    root["state"]["gates"] = "FAIL"
    res = root["make"]().execute()
    assert res["state"] == "GATES_FAILED" and authority(root) == B0
    assert not root["t"].exists(C.manifest_key(res["build_id"]))


def test_C_upload_failure_keeps_authority(root):
    root["state"]["fail"] = "publish"
    res = root["make"]().execute()
    assert res["state"] == "FAILED" and res["stage"] == "publish" and authority(root) == B0


def test_checkpoint_resume_skips_done_stages(root):
    root["state"]["fail"] = "publish"
    r1 = root["make"]("run-x").execute()
    assert r1["state"] == "FAILED"
    root["state"]["fail"] = None
    calls_before = len(root["state"]["calls"])
    r2 = root["make"]("run-x").execute()
    assert r2["state"] == "PUBLISHED_NOT_ADVANCED" and r2["build_id"] == r1["build_id"]
    assert "build" not in root["state"]["calls"][calls_before:]          # the build was a checkpoint, not redone


def test_singleton_lock_and_hold(root):
    from api.services.fundamentals_pit.schedule import _try_lock
    fd = _try_lock(os.path.join(root["root"], "refresh.lock"))
    try:
        assert root["make"]().execute()["state"] == "BUSY"
    finally:
        fd.close()
    open(os.path.join(root["root"], "HOLD"), "w").write("drill")
    assert root["make"]().execute()["state"] == "HOLD"
    assert authority(root) == B0


def test_methodology_drift_refuses_to_build(root, monkeypatch):
    monkeypatch.setattr(RF.M, "drift", lambda *a, **k: {"build.py": "deadbeef"})
    res = root["make"]().execute()
    assert res["state"] == "FAILED" and "methodology drift" in res["error"] and "build" not in root["state"]["calls"]


def test_scheduler_is_dark_and_single_owner(tmp_path, monkeypatch):
    from api.services.marketcap import schedule as S
    S._reset_for_tests()
    monkeypatch.delenv("MCAP_PIT_REFRESH", raising=False)
    assert S.start_worker_scheduler() == []
    monkeypatch.setenv("MCAP_PIT_REFRESH", "1")
    monkeypatch.setenv("MCAP_PIT_ROOT", str(tmp_path))
    assert S.start_worker_scheduler() == []                               # no refresh.json -> not provisioned
    (tmp_path / "refresh.json").write_text("{}")

    class FakeSched:
        def __init__(self):
            self.jobs = []

        def add_job(self, fn, **kw):
            self.jobs.append(kw)

        def start(self):
            pass

        def shutdown(self, wait=False):
            pass
    try:
        assert S.start_worker_scheduler(scheduler_factory=FakeSched) == [S.JOB_ID]
        S2 = S._owner["scheduler"]
        assert S2.jobs[0]["max_instances"] == 1 and S2.jobs[0]["coalesce"] is True
        from api.services.fundamentals_pit.schedule import _try_lock
        assert _try_lock(os.path.join(str(tmp_path), "scheduler.lock")) is None   # a second owner cannot start
    finally:
        S._reset_for_tests()
