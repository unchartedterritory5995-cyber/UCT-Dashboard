"""Market Cap V1 FAILURE MATRIX (production lifecycle gate, cases 1-25), dark/local only.

Real code under test: refresh orchestration (ledger, run lock, checkpoints, crash resume), publication (write-once,
read-back, verification), the AUTHORITY pointer (CAS, atomic replace, rollback), the member reader (pit_serving) and the
revoked-build rail. Stage BODIES are stubbed (the `root` harness of test_refresh_lifecycle); each case injects its fault
at the real seam. The invariant every case asserts: the member-facing authority is the previous valid one, or the new
one fully verified -- never anything in between."""
from __future__ import annotations

import json
import os

import pytest

from api.services.marketcap import acquire as Q, pit_serving as S, publication as P, refresh as RF, release_contract as C

from .lifecycle_fixtures import make_build, make_prices, manifest_fields, passing_validation
from .test_refresh_lifecycle import B0, authority, root  # noqa: F401 -- `root` is the shared harness fixture


def policy(env, **kw):
    p = os.path.join(env["root"], "refresh.json")
    cfg = json.load(open(p))
    cfg.setdefault("policy", {}).update(kw)
    json.dump(cfg, open(p, "w"))


def with_data(env):
    """The real sources() always creates the run's data dir (with prices.db); the stub harness does not."""
    orig = env["make"]

    def make(run_id=None):
        r = orig(run_id)
        inner = r.sources

        def sources():
            os.makedirs(r.data, exist_ok=True)
            open(os.path.join(r.data, "prices.db"), "wb").write(env["state"].get("px", b"session-1"))
            return inner()
        r.sources = sources
        return r
    return make


def last_state(env, run_id):
    return RF.Ledger(env["root"]).run(run_id)["state"]


@pytest.fixture
def reader(root, monkeypatch):  # noqa: F811
    monkeypatch.setenv("MCAP_PIT_SOURCE", "local")
    monkeypatch.setenv("MCAP_PIT_LOCAL_ROOT", root["t"].root)
    monkeypatch.delenv("MCAP_PIT_PIN", raising=False)
    monkeypatch.setattr(S, "CONTROL_TTL", 0.0)
    S.clear_cache()

    def served(fresh=True):
        if fresh:
            S.clear_cache()                       # a fresh web process: nothing "last verified" to fall back on
        try:
            return S.bound(force=True)["build_id"]
        except S.Unavailable:
            return None
    yield served
    S.clear_cache()


def pointer_build(env):
    return P.read_pointer(env["t"])["build_id"]


# ── 1-2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_01_no_new_session_waits_and_changes_nothing(root):  # noqa: F811
    make = with_data(root)
    r1 = make("run-a").execute()
    assert r1["state"] == "PUBLISHED_NOT_ADVANCED"
    calls = len(root["state"]["calls"])
    r2 = make("run-b").execute()
    assert r2["state"] == "WAITING_UPSTREAM"
    assert "build" not in root["state"]["calls"][calls:]                 # no derivation, no publication
    assert authority(root) == B0
    root["state"]["px"] = b"session-2"                                   # the next session's prices arrive
    assert make("run-c").execute()["state"] == "PUBLISHED_NOT_ADVANCED"


def test_02_normal_success_advances_from_a_human_rooted_authority(root, reader):  # noqa: F811
    policy(root, auto_advance=True)
    r = root["make"]().execute()
    assert r["state"] == "ADVANCED" and authority(root) == r["build_id"] and reader() == r["build_id"]
    p = P.read_pointer(root["t"])
    assert p["acceptance"] == "AUTOMATED_REFRESH" and p["human_rooted"] is True and p["previous"]["build_id"] == B0


# ── 3-9: every acquisition / derivation / validation failure leaves the authority ────────────────────────────────
def _real_sources(env, monkeypatch, tmp_path, **src):
    """Run the REAL Refresh.sources() for a given source config."""
    p = os.path.join(env["root"], "refresh.json")
    cfg = json.load(open(p))
    cfg["sources"] = src
    json.dump(cfg, open(p, "w"))
    r = RF.Refresh(env["root"])
    os.makedirs(r.logs, exist_ok=True)
    return r


def _uni(tmp_path):
    import gzip
    u = tmp_path / "u.json.gz"
    u.write_bytes(gzip.compress(json.dumps({"320193": ["", ["AAPL"]]}).encode()))
    return str(u)


def test_03_price_input_unavailable(root, monkeypatch, tmp_path, reader):  # noqa: F811
    r = _real_sources(root, monkeypatch, tmp_path, universe={"kind": "file", "path": _uni(tmp_path)},
                      prices={"kind": "file", "path": str(tmp_path / "missing_prices.db")})
    with pytest.raises(OSError):
        r.sources()
    root["state"]["fail"] = "sources"
    res = root["make"]().execute()
    assert res["state"] == "FAILED" and res["stage"] == "sources" and authority(root) == B0 and reader() == B0


def test_04_universe_unavailable(root, monkeypatch, tmp_path, reader):  # noqa: F811
    from api.services.fundamentals_pit import v5_publish as V5P
    monkeypatch.setattr(V5P, "R2Target", lambda: V5P.LocalTarget(str(tmp_path / "no_v5")))
    r = _real_sources(root, monkeypatch, tmp_path, universe={"kind": "v5_published"})
    with pytest.raises(Q.AcquisitionError, match="CURRENT"):
        r.sources()
    assert authority(root) == B0 and reader() == B0


def test_05_massive_reference_unavailable(root, monkeypatch, tmp_path, reader):  # noqa: F811
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)
    monkeypatch.delenv("POLYGON_API_KEY", raising=False)
    r = _real_sources(root, monkeypatch, tmp_path, universe={"kind": "file", "path": _uni(tmp_path)},
                      prices={"kind": "file", "path": make_prices(str(tmp_path / "px.db"))})
    with pytest.raises(Q.AcquisitionError, match="NOT CONFIGURED"):
        r.sources()
    assert authority(root) == B0 and reader() == B0


@pytest.mark.parametrize("case,stage,expect_stage", [
    ("06_sec_acquisition", "sec_bulk", "sec_bulk"),
    ("07_identity_update", "identity", "identity"),
    ("08_derivation", "build", "build_1"),
])
def test_06_07_08_stage_failures_keep_authority(root, reader, case, stage, expect_stage):  # noqa: F811
    if stage == "sec_bulk":
        def boom():
            raise OSError("sec.gov unreachable")
        orig = root["make"]

        def make(run_id=None):
            r = orig(run_id)
            r.sec = boom
            return r
        res = make().execute()
    else:
        root["state"]["fail"] = stage
        res = root["make"]().execute()
    assert res["state"] == "FAILED" and res["stage"] == expect_stage
    assert authority(root) == B0 and reader() == B0


def test_09_validation_failure_publishes_nothing(root, reader):  # noqa: F811
    policy(root, auto_advance=True)
    root["state"]["gates"] = "FAIL"
    res = root["make"]().execute()
    assert res["state"] == "GATES_FAILED" and not root["t"].exists(C.manifest_key(res["build_id"]))
    assert authority(root) == B0 and reader() == B0


# ── 10-14: publication / verification / pointer ──────────────────────────────────────────────────────────────────
def test_10_incomplete_artifact_is_never_a_manifest(root, monkeypatch, reader):  # noqa: F811
    policy(root, auto_advance=True)
    real = P.LocalTarget.put_new
    dropped = []

    def lossy(self, key, body):
        if "/obj/" in key and not dropped:
            dropped.append(key)                    # the upload "succeeds" but the object never lands
            return
        return real(self, key, body)
    monkeypatch.setattr(P.LocalTarget, "put_new", lossy)
    res = root["make"]().execute()
    assert dropped and res["state"] == "FAILED" and res["stage"] == "publish"
    assert not root["t"].exists(C.manifest_key(res["build_id"])) and authority(root) == B0 and reader() == B0


def test_11_checksum_mismatch_db_is_never_published(root, reader):  # noqa: F811
    orig = root["make"]

    def make(run_id=None):
        r = orig(run_id)
        r._seal = lambda bp: {"db_sha256": "f" * 64, "db_bytes": 1, "inputs": {}}
        mf = r.manifest_fields
        r.manifest_fields = lambda bp, build, src, sec: {**mf(bp, build, src, sec),
                                                         "build": {**mf(bp, build, src, sec)["build"], "db_sha256": "f" * 64}}
        return r
    res = make().execute()
    assert res["state"] == "FAILED" and res["stage"] == "publish"
    assert not root["t"].exists(C.manifest_key(res["build_id"])) and authority(root) == B0 and reader() == B0


def test_12_upload_failure(root, reader):  # noqa: F811
    root["state"]["fail"] = "publish"
    res = root["make"]().execute()
    assert res["state"] == "FAILED" and res["stage"] == "publish" and authority(root) == B0 and reader() == B0


def test_13_upload_succeeds_but_verification_fails(root, monkeypatch, reader):  # noqa: F811
    policy(root, auto_advance=True)
    real = P.verify_build
    monkeypatch.setattr(P, "verify_build", lambda *a, **k: (_ for _ in ()).throw(P.PublishError("read-back mismatch")))
    res = root["make"]().execute()
    assert res["state"] == "FAILED" and res["stage"] == "publish" and authority(root) == B0
    monkeypatch.setattr(P, "verify_build", real)
    assert reader() == B0                                                # the orphan manifest is not authority


def test_14_pointer_write_failure(root, monkeypatch, reader):  # noqa: F811
    policy(root, auto_advance=True)

    def fail(self, key, body):
        raise OSError("R2 PUT AUTHORITY.json failed")
    monkeypatch.setattr(P.LocalTarget, "put_mutable", lambda self, key, body: fail(self, key, body)
                        if key == C.AUTHORITY_KEY else None)
    res = root["make"]().execute()
    assert res["state"] == "FAILED" and res["stage"] == "advance"
    monkeypatch.undo()
    assert pointer_build(root) == B0


# ── 15-17: crashes (a deploy / OOM / kill: the process dies, the run row stays RUNNING) ────────────────────────────
class Killed(BaseException):
    """Not an Exception: the run's own handler never sees it -- exactly like a SIGKILL."""


def _crash_at(env, stage_attr):
    orig = env["make"]

    def make(run_id=None):
        r = orig(run_id)
        inner = getattr(r, stage_attr)

        def die(*a, **k):
            raise Killed(stage_attr)
        setattr(r, stage_attr, die)
        r._inner = inner
        return r
    return make


def test_15_crash_before_publication_resumes_from_checkpoints(root, reader):  # noqa: F811
    with pytest.raises(Killed):
        _crash_at(root, "_suite")("run-c").execute()
    assert last_state(root, "run-c") == "RUNNING" and authority(root) == B0 and reader() == B0
    builds = root["state"]["n"]
    res = root["make"]().execute()                                       # the next scheduled / catch-up run
    assert res["run_id"] == "run-c" and res["state"] == "PUBLISHED_NOT_ADVANCED"
    assert root["state"]["n"] == builds                                  # build_1 was a checkpoint: not rebuilt
    assert authority(root) == B0


def test_16_crash_after_publication_before_advance(root, reader):  # noqa: F811
    policy(root, auto_advance=True)
    with pytest.raises(Killed):
        _crash_at(root, "_advance")("run-d").execute()
    rd = RF.Ledger(root["root"]).stage_done("run-d", "publish")
    assert rd and root["t"].exists(C.manifest_key(json.loads(json.dumps(rd))["build_id"]))
    assert authority(root) == B0 and reader() == B0                      # published is not authority
    res = root["make"]().execute()
    assert res["run_id"] == "run-d" and res["state"] == "ADVANCED"      # publish NOT redone (write-once), advance done
    assert authority(root) == res["build_id"] and reader() == res["build_id"]


def test_17_crash_during_the_pointer_write_is_atomic(root, monkeypatch, reader):  # noqa: F811
    policy(root, auto_advance=True)
    real_replace = os.replace

    def die_on_pointer(src, dst):
        if str(dst).endswith("AUTHORITY.json"):
            raise Killed("killed between temp write and rename")
        return real_replace(src, dst)
    monkeypatch.setattr(os, "replace", die_on_pointer)
    with pytest.raises(Killed):
        root["make"]("run-e").execute()
    monkeypatch.setattr(os, "replace", real_replace)
    assert pointer_build(root) == B0 and reader() == B0                  # OLD VALID authority, never half-written
    res = root["make"]().execute()
    assert res["run_id"] == "run-e" and res["state"] == "ADVANCED" and reader() == res["build_id"]


# ── 18-20: duplicate invocation / restarts ──────────────────────────────────────────────────────────────────────────
def test_18_duplicate_invocation_and_two_schedulers(root, tmp_path, monkeypatch):  # noqa: F811
    from api.services.fundamentals_pit.schedule import _try_lock
    from api.services.marketcap import schedule as SCH
    fd = _try_lock(os.path.join(root["root"], "refresh.lock"))
    try:
        assert root["make"]().execute()["state"] == "BUSY"               # manual run during a scheduled run
    finally:
        fd.close()
    held = _try_lock(str(tmp_path / "scheduler.lock"))                   # worker #1 owns the scheduler
    try:
        monkeypatch.setenv("MCAP_PIT_REFRESH", "1")
        monkeypatch.setenv("MCAP_PIT_ROOT", root["root"])
        SCH._reset_for_tests()
        assert SCH.start_worker_scheduler(scheduler_factory=object, lock_path=str(tmp_path / "scheduler.lock")) == []
    finally:
        held.close()
        SCH._reset_for_tests()
    assert authority(root) == B0


def test_19_restart_after_successful_publication(root, reader):  # noqa: F811
    make = with_data(root)
    r1 = make().execute()
    assert r1["state"] == "PUBLISHED_NOT_ADVANCED"
    r2 = make().execute()                                                # worker restarted, same inputs
    assert r2["state"] == "WAITING_UPSTREAM" and authority(root) == B0 and reader() == B0
    assert RF.Ledger(root["root"]).run(r1["run_id"])["state"] == "PUBLISHED_NOT_ADVANCED"


def test_20_restart_after_failed_publication_starts_clean(root, reader):  # noqa: F811
    root["state"]["fail"] = "publish"
    r1 = root["make"]("run-f").execute()
    assert r1["state"] == "FAILED"
    root["state"]["fail"] = None
    r2 = root["make"]().execute()                                        # a FAILED run is not adopted
    assert r2["run_id"] != "run-f" and r2["state"] == "PUBLISHED_NOT_ADVANCED" and r2["build_id"] != r1["build_id"]
    assert authority(root) == B0 and reader() == B0


# ── 21-24: missing / corrupted / rejected artifacts ─────────────────────────────────────────────────────────────────
def test_21_previous_authority_missing(root, reader):  # noqa: F811
    policy(root, auto_advance=True)
    os.remove(root["t"]._p(C.manifest_key(B0)))
    assert reader() is None                                              # fail closed (503), no fallback
    res = root["make"]().execute()
    assert res["state"] == "FAILED" and res["stage"] == "advance"        # never auto-advances over a broken authority
    assert pointer_build(root) == B0


def _doc_key(env, bid):
    m = P.read_manifest(env["t"], bid, P.read_pointer(env["t"])["manifest_sha256"])
    return C.obj_key(sorted(m["artifacts"]["documents"].values())[0])


def test_22_selected_artifact_missing(root, reader):  # noqa: F811
    k = _doc_key(root, B0)
    os.remove(root["t"]._p(k))
    with pytest.raises(P.PublishError):
        P.verify_build(root["t"], B0, P.read_pointer(root["t"])["manifest_sha256"])
    S.clear_cache()
    sha = k.rsplit("/", 1)[1].split(".")[0]
    with pytest.raises(S.Unavailable):
        S._document(sha)                                                 # the reader never serves a missing document


def test_23_selected_artifact_corrupted(root, reader):  # noqa: F811
    k = _doc_key(root, B0)
    p = root["t"]._p(k)
    os.chmod(p, 0o644)
    open(p, "ab").write(b"x")
    S.clear_cache()
    sha = k.rsplit("/", 1)[1].split(".")[0]
    with pytest.raises(S.Unavailable):
        S._document(sha)
    with pytest.raises(P.PublishError):
        P.verify_build(root["t"], B0, P.read_pointer(root["t"])["manifest_sha256"])


def test_24_rejected_build_in_namespace_is_never_selected(root, tmp_path, monkeypatch, reader):  # noqa: F811
    # a NEWER, lexically LATER build sits in the bucket (and on disk) -- then it is revoked
    late = "MCAP_V1-20991231T235959Z"
    db = make_build(str(tmp_path / "late.db"), late, last_day=20261002)
    P.publish_build(root["t"], build_db=db, prices_db=make_prices(str(tmp_path / "px.db")),
                    manifest_fields=manifest_fields(late, P.file_sha(db)[0]), validation=passing_validation())
    monkeypatch.setitem(C.REVOKED_BUILDS, late, {"db_sha256": P.file_sha(db)[0], "reason": "rejected"})
    assert reader() == B0                                                # newest / lexical / mtime never matter
    with pytest.raises(C.ContractError):
        P.advance(root["t"], late, P.A.sha(root["t"].get(C.manifest_key(late))), expect_current=B0, by="x",
                  reason="x", acceptance="HUMAN_CUTOVER")
    assert pointer_build(root) == B0


# ── 25: rollback during / after a failed refresh ────────────────────────────────────────────────────────────────────
def test_25_rollback_after_a_failed_refresh(root, reader):  # noqa: F811
    policy(root, auto_advance=True)
    ok = root["make"]().execute()
    assert ok["state"] == "ADVANCED" and reader() == ok["build_id"]
    root["state"]["gates"] = "FAIL"
    bad = root["make"]().execute()                                       # the next refresh fails
    assert bad["state"] == "GATES_FAILED" and reader() == ok["build_id"]
    b0_sha = P.read_pointer(root["t"])["previous"]["manifest_sha256"]
    P.rollback(root["t"], B0, b0_sha, expect_current=ok["build_id"], by="owner", reason="drill")
    assert reader() == B0 and P.read_pointer(root["t"])["acceptance"] == "ROLLBACK"
    # forward restoration: the newer build is still there, re-verified, and can be restored
    ok_sha = P.A.sha(root["t"].get(C.manifest_key(ok["build_id"])))
    P.advance(root["t"], ok["build_id"], ok_sha, expect_current=B0, by="owner", reason="forward", acceptance="HUMAN_CUTOVER")
    assert reader() == ok["build_id"]


# ── restart catch-up (a deploy at the fire time, or a killed run) ──────────────────────────────────────────────────
def test_scheduler_catch_up_after_a_restart(tmp_path, monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from api.services.marketcap import schedule as SCH
    et = ZoneInfo("America/New_York")
    L = RF.Ledger(str(tmp_path))
    wed_0300 = datetime(2026, 10, 7, 3, 0, tzinfo=et)                      # fire was Wed 01:15 ET
    assert SCH.last_fire(wed_0300) == datetime(2026, 10, 7, 1, 15, tzinfo=et)
    assert SCH.last_fire(datetime(2026, 10, 5, 12, 0, tzinfo=et)) == datetime(2026, 10, 3, 1, 15, tzinfo=et)  # Mon -> Sat
    assert SCH.catch_up_reason(str(tmp_path), wed_0300).startswith("missed fire")
    assert SCH.catch_up_reason(str(tmp_path), datetime(2026, 10, 7, 9, 0, tzinfo=et)) is None   # past the window
    with L.db:
        L.db.execute("INSERT INTO run(run_id, state, started_at) VALUES ('run-x', 'PUBLISHED_NOT_ADVANCED', '2026-10-07T05:16:00Z')")
    assert SCH.catch_up_reason(str(tmp_path), wed_0300) is None                                 # it ran
    with L.db:
        L.db.execute("INSERT INTO run(run_id, state, started_at) VALUES ('run-y', 'RUNNING', '2026-10-07T05:20:00Z')")
    assert SCH.catch_up_reason(str(tmp_path), wed_0300) == "interrupted run"
    assert SCH.catch_up_reason(str(tmp_path / "unprovisioned"), wed_0300) is None

    class FakeSched:
        def __init__(self):
            self.jobs = []

        def add_job(self, fn, **kw):
            self.jobs.append(kw)

        def start(self):
            pass

        def shutdown(self, wait=False):
            pass
    (tmp_path / "refresh.json").write_text("{}")
    monkeypatch.setenv("MCAP_PIT_REFRESH", "1")
    monkeypatch.setenv("MCAP_PIT_ROOT", str(tmp_path))
    SCH._reset_for_tests()
    try:
        ids = SCH.start_worker_scheduler(scheduler_factory=FakeSched, lock_path=str(tmp_path / "scheduler.lock"))
        assert ids == [SCH.JOB_ID, SCH.JOB_ID + "_catchup"]                # the interrupted run is resumed promptly
        assert SCH._owner["scheduler"].jobs[1]["trigger"] == "date"
    finally:
        SCH._reset_for_tests()
