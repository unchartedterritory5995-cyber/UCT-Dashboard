"""The first-paint preparer: build the view the page opens on BEFORE a member asks.

A cold parts build is ~3.5-7.4 s of intrinsic work and the client gives up at
3 s, so the first member after every version roll falls back to the raw tape and
pays ~3.7 MB for a page everyone else gets in ~200 ms. The preparer removes that
member from the equation by running the SAME build, from a background thread,
the moment the data version changes.

⛔ WHAT THESE TESTS ARE REALLY GUARDING. Two failure modes, both of which this
repo has shipped before in other subsystems:

  1. A preparer that is written, documented, and wired into no scheduler at all
     (the desk insights pass lived that way for weeks).
  2. A preparer that stops making progress but keeps reporting success, because
     a declined tick recorded the version as handled. Its own counters would say
     "prepared" while every member paid the cold build.

Both are pinned below, each with a control proving the probe can see the thing
it is looking for.
"""
import ast
import pathlib

import pytest

from api import flow_router as fr
from api.services import flow_aggregate as fa

REPO = pathlib.Path(__file__).resolve().parents[1]


# ── The view has ONE authority ────────────────────────────────────────────────

def test_health_and_the_preparer_grade_the_same_view():
    """⛔ If these were named separately they would drift, and the preparer could
    report success for a view nobody opens while health honestly said cold --
    each looking correct on its own."""
    import inspect
    sig = inspect.signature(fa.health)
    assert sig.parameters["view"].default is fa.DEFAULT_VIEW
    # And it is the view the page actually opens on.
    assert fa.DEFAULT_VIEW == ("stocks", 1, "Last1")


# ── Progress is only recorded when a build actually happened ──────────────────

class _Recorder:
    """Stands in for flow_aggregate.get_cached_or_build_part."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    def __call__(self, key, version, provider, date_filter, part):
        self.calls.append((key, version, date_filter, part))
        return self.result(version) if callable(self.result) else self.result


@pytest.fixture(autouse=True)
def _reset_state():
    fr._PREPARE_STATE.update({"prepared": 0, "declined": 0, "failed": 0,
                              "last_version": None, "last_ms": None,
                              "last_error": None})
    yield


def _patch(monkeypatch, *, version, builder):
    monkeypatch.setattr(fr, "_current_version", lambda: version)
    monkeypatch.setattr(fa, "get_cached_or_build_part", builder)
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (version, __import__("gzip").compress(b"csv")))


def test_a_successful_build_records_the_version_as_prepared(monkeypatch):
    rec = _Recorder(lambda v: (v, b"gz"))
    _patch(monkeypatch, version=1001, builder=rec)

    out = fr._prepare_once(None)

    assert out == 1001
    assert fr._PREPARE_STATE["prepared"] == 1
    assert fr._PREPARE_STATE["last_version"] == 1001
    # CONTROL: it asked for the default view, not something of its own devising.
    assert rec.calls[0][0] == ("stocks", 1, "Last1")
    assert rec.calls[0][3] == "bootstrap"


def test_a_DECLINED_tick_does_not_record_progress_and_so_retries(monkeypatch):
    """⛔ THE ONE THAT MATTERS. `get_cached_or_build_part` hands back a STALE
    entry when the build lock is held by a member, so bytes came back but they
    are the WRONG version. Recording that as done would retire the roll and this
    thread would go silently idle -- prepared:1, members cold, forever."""
    stale = _Recorder((999, b"old-gz"))          # older version than current
    _patch(monkeypatch, version=1001, builder=stale)

    out = fr._prepare_once(None)

    assert out is None, "a declined tick must not claim the version"
    assert fr._PREPARE_STATE["prepared"] == 0
    assert fr._PREPARE_STATE["declined"] == 1

    # And the retry actually happens: the very next tick tries again.
    fresh = _Recorder(lambda v: (v, b"gz"))
    _patch(monkeypatch, version=1001, builder=fresh)
    assert fr._prepare_once(out) == 1001
    assert len(fresh.calls) == 1


def test_a_build_returning_nothing_also_does_not_record_progress(monkeypatch):
    _patch(monkeypatch, version=1001, builder=_Recorder(None))
    assert fr._prepare_once(None) is None
    assert fr._PREPARE_STATE["prepared"] == 0


def test_a_raising_build_is_caught_and_does_not_record_progress(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("node died")
    _patch(monkeypatch, version=1001, builder=boom)

    assert fr._prepare_once(None) is None
    assert fr._PREPARE_STATE["failed"] == 1
    assert "node died" in (fr._PREPARE_STATE["last_error"] or "")


# ── It is version-triggered, which is what keeps it off a quiet tape ──────────

def test_an_unchanged_version_does_no_work_at_all(monkeypatch):
    """This is the whole market-hours gate. The version only moves when rows
    actually change, so a closed tape costs nothing and needs no clock (one
    version was observed holding for 5h07m on 2026-09-08)."""
    rec = _Recorder(lambda v: (v, b"gz"))
    _patch(monkeypatch, version=1001, builder=rec)

    assert fr._prepare_once(1001) == 1001
    assert rec.calls == [], "rebuilt a version that was already prepared"

    # CONTROL: the same recorder DOES build when the version moves, so the
    # assertion above is about the version check and not a dead builder.
    _patch(monkeypatch, version=1002, builder=rec)
    assert fr._prepare_once(1001) == 1002
    assert len(rec.calls) == 1


# ── It yields to members rather than competing with them ─────────────────────

def test_it_goes_through_the_members_own_single_flight_path():
    """⛔ Not a private builder. Using `get_cached_or_build_part` is what makes
    the preparer decline (non-blocking lock) whenever a real request is
    building, and is what guarantees the product is byte-identical to what a
    member would have received."""
    src = pathlib.Path(fr.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "_prepare_once")
    called = {ast.unparse(n.func) for n in ast.walk(fn) if isinstance(n, ast.Call)}
    assert "flow_aggregate.get_cached_or_build_part" in called, (
        "the preparer stopped using the member's single-flight path -- it can "
        "now compete with real requests and may not produce the same bytes")


# ── It is actually wired, and it is gated ────────────────────────────────────

def test_the_preparer_is_wired_into_the_flow_worker_startup():
    """⛔ A background job that is written, documented and started by nothing
    reads as coverage. That is not hypothetical here: the desk insights pass
    was defined with zero callers for weeks."""
    src = (REPO / "api" / "flow_worker_main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    calls = {ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    assert any(c.endswith("start_background_prepare") for c in calls), (
        "nothing starts the preparer")
    # CONTROL: the probe can see a sibling starter, so a green result here is
    # not "ast.walk found nothing at all".
    assert any(c.endswith("start_background_warm") for c in calls), (
        "the probe cannot see known startup calls -- this test is vacuous")


def test_it_refuses_to_start_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv("FLOW_PREPARE_ENABLED", raising=False)
    monkeypatch.setattr(fa, "parts_enabled", lambda: True)
    assert fr.start_background_prepare() is False


def test_it_refuses_to_start_when_the_transport_it_warms_is_off(monkeypatch):
    """Warming a transport nothing serves would burn CPU and report healthy."""
    monkeypatch.setenv("FLOW_PREPARE_ENABLED", "1")
    monkeypatch.setattr(fa, "parts_enabled", lambda: False)
    assert fr.start_background_prepare() is False


def test_prepare_state_is_a_copy_so_a_caller_cannot_corrupt_the_counters():
    fr.prepare_state()["prepared"] = 9999
    assert fr._PREPARE_STATE["prepared"] != 9999
