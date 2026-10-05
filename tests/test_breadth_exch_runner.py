"""The exchange runner inside breadth-v2-runner: dependency order (US V2 publication → archive + ack → compute
→ independent validation → publish), single writer, idempotence, currentness — and the scheduler rows of the
failure matrix. Compute/validate subprocesses are faked; everything else is the real code."""
from __future__ import annotations

import json
import os
import sqlite3

import pytest

from api.services import breadth_exchange_authority as ea
from api.services import breadth_exchange_publish as ep
from api.services import breadth_exchange_runner as exr
from api.services import breadth_v2_producer as prod
from api.services import breadth_vintage_archive as va
from tests.test_breadth_exch_authority import LIVE, world  # noqa: F401  (fixture)


class _Lock:
    def close(self):
        pass


@pytest.fixture
def rig(world, tmp_path, monkeypatch):  # noqa: F811
    proot, arch = str(tmp_path / "producer"), str(tmp_path / "archive")
    monkeypatch.setattr(prod, "ROOT", proot)
    monkeypatch.setattr(prod, "EXCH_ARCHIVE_DIR", arch)
    monkeypatch.setattr(prod, "_alarm", lambda *a: None)
    monkeypatch.setattr(exr, "RUNNER_ROOT", str(tmp_path / "runner"))
    monkeypatch.setattr(exr, "STORE_DIR", os.path.dirname(world["live"]))
    monkeypatch.setattr(exr, "PARENTS_ROOT", str(tmp_path / "parents"))
    monkeypatch.setattr(exr, "_lock", lambda: _Lock())
    os.makedirs(str(tmp_path / "parents" / "final"))
    import shutil
    shutil.copy(world["hist"], str(tmp_path / "parents" / "final" / ea.HIST_NAME))
    shutil.copy(world["der"], str(tmp_path / "parents" / "final" / ea.DER_NAME))
    for k in ("BREADTH_EXCH_ARCHIVER_ENABLED", "BREADTH_EXCH_COMPUTE_ENABLED", "BREADTH_EXCH_PUBLISH_ENABLED"):
        monkeypatch.setenv(k, "1")
    calls = []

    def publish_us(d, tag, state="CURRENT"):
        """The producer published session d from vintage `tag` (and the vintage exists, READY)."""
        vd = os.path.join(proot, "vintages", tag)
        if not os.path.isdir(vd):
            for sub in ("inputs_", "grouped_"):
                os.makedirs(os.path.join(vd, sub + tag))
            open(os.path.join(vd, "inputs_" + tag, "INPUT_MANIFEST.json"), "w").write(tag)
            open(os.path.join(vd, "inputs_" + tag, "pit_reference.json"), "w").write("r")
            open(os.path.join(vd, "grouped_" + tag, "x_0.json"), "w").write("[]")
            with prod._state() as c:
                c.execute("INSERT INTO vintage VALUES(?,?,?,?,?,?,?,?)", (tag, d, "", "", "", tag, "ready", "{}"))
        prod._set(d, state, vintage=tag)
        if state == "CURRENT":
            with prod._canon() as c:
                c.execute("INSERT INTO v2_session VALUES(?,?,?,?,?)",
                          (d, d + "-" + tag, "x", json.dumps({"vintage_tag": tag}), "t"))

    def fake_run(args, **kw):
        """compute = the leg appending every published, not-yet-stored session; validate = pass."""
        calls.append(os.path.basename(args[2] if "run_overlay" in args[1] else args[1]))

        class R:
            returncode = 0
        if "exch_live_leg.py" in " ".join(args):
            have = set(exr._store_view()["sessions"])
            pv = exr._producer_view()
            for d in sorted(pv["published"]):
                if d not in have:
                    world["append"](d)
            json.dump({"appended": [], "refused": None, "currentness": {"latest_venue_evidence_session": "2099"}},
                      open(os.path.join(exr.STORE_DIR, "STATUS.json"), "w"))
        elif "validate_live_store.py" in " ".join(args):
            out = args[3]
            os.makedirs(os.path.dirname(out), exist_ok=True)
            json.dump({"pass": rig_state["validate_pass"]}, open(out, "w"))
        return R()

    rig_state = {"validate_pass": True}
    return {"world": world, "publish_us": publish_us, "run": fake_run, "calls": calls, "arch": arch,
            "store": world["store"], "state": rig_state}


def _cycle(rig):
    return exr.cycle(run=rig["run"], store=rig["store"])


def test_dependency_order_archive_then_compute_then_validate_then_publish(rig):
    rig["publish_us"]("2026-09-25", "pA")
    st = _cycle(rig)
    assert st["steps"]["archive"] == {"pA": "archived"}                       # archive + ack first
    assert rig["calls"] == ["exch_live_leg.py", "validate_live_store.py"]       # then compute, then validate
    assert st["steps"]["publish"]["published"] == 1                            # then the one pointer switch
    assert st["state"] == "CURRENT" and st["members_have"] == st["members_should_have"] == "2026-09-25"
    assert st["owner_archived"] is True and st["authority_current"] is True


def test_rerun_with_no_new_input_changes_nothing(rig):
    rig["publish_us"]("2026-09-25", "pA")
    _cycle(rig)
    p1 = ep.current(rig["store"])["sha256"]
    n = len(rig["calls"])
    st = _cycle(rig)
    assert len(rig["calls"]) == n                                              # no compute, no re-validation
    assert st["steps"]["publish"]["reason"] == "already current"
    assert ep.current(rig["store"])["sha256"] == p1 and st["state"] == "CURRENT"


def test_not_yet_published_and_incomplete_publication_are_not_computed(rig):
    rig["publish_us"]("2026-09-25", "pA")
    rig["publish_us"]("2026-09-28", "pB", state="RETRYING")                    # producer has not published it
    st = _cycle(rig)
    assert exr._store_view()["sessions"] == ["2026-09-25"]
    assert st["members_should_have"] == "2026-09-25" and st["state"] == "CURRENT"


def test_waiting_for_archive_blocks_compute(rig, monkeypatch):
    monkeypatch.setenv("BREADTH_EXCH_ARCHIVER_ENABLED", "0")                   # archiver down
    rig["publish_us"]("2026-09-25", "pA")
    st = _cycle(rig)
    assert "exch_live_leg.py" not in rig["calls"] and st["state"] == "WAITING_FOR_ARCHIVE"
    assert st["owners_unarchived"] == ["pA"]
    monkeypatch.setenv("BREADTH_EXCH_ARCHIVER_ENABLED", "1")                   # recovers
    assert _cycle(rig)["state"] == "CURRENT"


def test_behind_by_one_session_and_catch_up(rig, monkeypatch):
    rig["publish_us"]("2026-09-25", "pA")
    _cycle(rig)
    rig["publish_us"]("2026-09-28", "pB")
    monkeypatch.setenv("BREADTH_EXCH_COMPUTE_ENABLED", "0")
    st = _cycle(rig)
    assert st["state"] == "BEHIND (1 session)" and st["sessions_behind"] == 1
    assert st["members_have"] == "2026-09-25" and st["members_should_have"] == "2026-09-28"
    monkeypatch.setenv("BREADTH_EXCH_COMPUTE_ENABLED", "1")
    st = _cycle(rig)
    assert st["state"] == "CURRENT" and st["members_have"] == "2026-09-28"


def test_multiple_publications_before_a_run_each_keep_their_own_owner(rig):
    for d, t in (("2026-09-25", "pA"), ("2026-09-28", "pB"), ("2026-09-29", "pC")):
        rig["publish_us"](d, t)
    st = _cycle(rig)
    assert set(st["steps"]["archive"]) == {"pA", "pB", "pC"}
    assert all(va.cheap_state(rig["arch"], t) == "acked" for t in ("pA", "pB", "pC"))
    assert st["members_have"] == "2026-09-29" and st["state"] == "CURRENT"


def test_validation_failure_never_publishes(rig):
    rig["publish_us"]("2026-09-25", "pA")
    rig["state"]["validate_pass"] = False
    st = _cycle(rig)
    assert "publish" not in st["steps"] and ep.current(rig["store"]) is None
    assert st["validation_passed"] is False and st["state"] != "CURRENT"


def test_compute_failure_or_timeout_keeps_the_previous_authority(rig, monkeypatch):
    rig["publish_us"]("2026-09-25", "pA")
    _cycle(rig)
    before = ep.current(rig["store"])["sha256"]
    rig["publish_us"]("2026-09-28", "pB")

    def timeout_run(args, **kw):
        if "exch_live_leg.py" in " ".join(args):
            import subprocess
            raise subprocess.TimeoutExpired(args, 1)
        return rig["run"](args, **kw)
    st = exr.cycle(run=timeout_run, store=rig["store"])
    assert st["steps"]["compute"]["rc"] == 124
    assert ep.current(rig["store"])["sha256"] == before and st["members_have"] == "2026-09-25"


def test_duplicate_invocation_and_hold(rig, monkeypatch):
    monkeypatch.setattr(exr, "_lock", lambda: None)                             # another writer holds the lock
    assert exr.cycle(run=rig["run"], store=rig["store"])["state"] == "SKIPPED_DUPLICATE"
    assert rig["calls"] == []
    monkeypatch.setattr(exr, "_lock", lambda: _Lock())
    os.makedirs(exr.RUNNER_ROOT, exist_ok=True)
    open(os.path.join(exr.RUNNER_ROOT, "HOLD"), "w").close()
    assert _cycle(rig)["state"] == "PARKED" and rig["calls"] == []


def test_rollback_in_force_is_reported_and_holds(rig):
    rig["publish_us"]("2026-09-25", "pA")
    _cycle(rig)
    rig["publish_us"]("2026-09-28", "pB")
    _cycle(rig)
    ep.rollback(rig["store"], 1)
    st = _cycle(rig)
    assert st["state"] == "ROLLBACK_IN_FORCE" and st["steps"]["publish"]["reason"] == "ROLLBACK_IN_FORCE"
    assert st["members_have"] == "2026-09-25"


def test_status_answers_every_operator_question(rig):
    rig["publish_us"]("2026-09-25", "pA")
    st = _cycle(rig)
    for k in ("members_should_have", "members_have", "owner_vintage_latest", "owner_archived",
              "venue_evidence_ready", "identity_ready", "compute_passed", "validation_passed",
              "authority_current", "archive_guard", "state"):
        assert k in st, k
    assert json.load(open(exr.status_path()))["state"] == st["state"]


def test_compute_runs_the_in_repo_pinned_engine_with_argv_paths():
    a = exr.compute_args()
    assert a[1].endswith(os.path.join("breadth_exch", "run_overlay.py")) and a[2].endswith("exch_live_leg.py")
    for flag in ("--store", "--mode", "--code-commit", "--root", "--prod-root", "--archive", "--launch"):
        assert flag in a
    assert a[a.index("--mode") + 1] == "append" and a[a.index("--launch") + 1] == a[1]


def test_only_a_declared_session_with_the_declared_true_owner_uses_the_substitute():
    exc = {"2026-09-25": ("p202609292209", "p202609302026")}
    assert exr.required_vintage("2026-09-25", "p202609292209", exc) == "p202609302026"
    assert exr.required_vintage("2026-09-25", "pOTHER", exc) == "pOTHER"        # owner differs → no waiver
    assert exr.required_vintage("2026-09-29", "p202609292209", exc) == "p202609292209"
    real = exr._declared_exceptions()
    assert real == {"2026-09-25": ("p202609292209", "p202609302026"),
                    "2026-09-28": ("p202609292209", "p202609302026")}
