"""The Wisdom R2 rail: a test may never build a real bucket client.

2026-09-13 incident. A sources-stream test run wrote 16 objects (2,399 bytes)
into the PRODUCTION bucket under `wisdom/sources/zoom_vtt/`. The operator's
shell already carried DATA_SYNC_*, so the real client built itself and every
write succeeded — nothing failed, nothing was logged as wrong. Deleting those
objects needed a one-off guarded script because this module has no delete path
by design.

⛔ Each check here must be able to FAIL, so every section carries its control:
   * the guard is proved ARMED in this very run (otherwise every assertion
     below passes over an inert guard — `lesson_gate_that_cannot_fail`);
   * the guard is proved to stay SILENT for a pod-shaped process, because a
     rail that fires in production is a worse defect than the one it prevents;
   * the covered-function list is DERIVED from r2.py's AST, so a fourth
     function that reaches the client fails this file BY NAME rather than
     shipping unguarded (`lesson_a_gate_list_drifts_like_any_other_artifact`).

Mutation-proved 2026-09-13. Counts are MEASURED, not estimated — the harness
restored r2.py from its original bytes after each one and re-checked the file's
sha256 (`0576394ded84495b` before and after all four), and the run ended green:

   * `ALLOW_REAL_CLIENT_UNDER_PYTEST = True`        -> 5 failed, 5 passed
   * guard clause deleted from `_client_and_bucket` -> 4 failed, 6 passed
   * `_under_pytest` pinned `return True`           -> 1 failed, 9 passed  (the pod check alone)
   * `_under_pytest` pinned `return False`          -> 6 failed, 4 passed

⚠️ A mutated run is SLOW (~20-30s vs ~1s green): with the guard gone the doors
below really do try to reach `example.invalid` and pay boto3's retry budget.
That cost is the proof the guard is load-bearing, and it is never paid on green.
"""
from __future__ import annotations

import ast
import inspect
import pathlib

import pytest

from api.services.wisdom.core import r2


# ── the guard is armed right now ─────────────────────────────────────────────

def test_the_guard_is_armed_in_this_very_run():
    """Non-vacuity control. Without this, a broken predicate makes the whole
    file pass by never reaching any guarded path."""
    assert r2._under_pytest() is True
    assert r2.ALLOW_REAL_CLIENT_UNDER_PYTEST is False


def test_it_refuses_a_real_client_with_the_env_that_caused_the_leak(monkeypatch):
    """The exact 2026-09-13 condition: DATA_SYNC_* present in the shell."""
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.invalid")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "not-a-real-key")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "not-a-real-secret")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "uct-bars-snapshots")

    with pytest.raises(r2.R2TestIsolation):
        r2._client_and_bucket()


def test_the_documented_opt_in_gets_past_the_guard_and_nothing_else_does(monkeypatch):
    """Control for the test above: prove the GUARD is what refused, not a
    missing config. With the opt-in set and no DATA_SYNC_* at all, the call
    reaches the ordinary path and fails there instead — a different exception."""
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY",
                "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(r2, "ALLOW_REAL_CLIENT_UNDER_PYTEST", True)

    with pytest.raises(r2.R2Unavailable):
        r2._client_and_bucket()


# ── every door into the bucket is behind the guard ───────────────────────────

def _functions_that_reach_the_client() -> set[str]:
    """Read r2.py's AST for public functions whose body calls _client_and_bucket.

    Derived, never typed: a new function that reaches the bucket joins this set
    the day it lands, and the assertion below then names it.
    """
    tree = ast.parse(pathlib.Path(inspect.getfile(r2)).read_text(encoding="utf-8"))
    found = set()
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef) or node.name.startswith("_"):
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.Call) and getattr(inner.func, "id", None) == "_client_and_bucket":
                found.add(node.name)
    return found


_EXERCISED = {
    "put_immutable": lambda: r2.put_immutable("wisdom/probe/x.txt", b"x", "text/plain"),
    # ⛔ NON-EMPTY on purpose: put_verified refuses an empty payload BEFORE it builds a
    # client, so probing it with b"" would raise R2VerificationFailed and the isolation
    # assertion would pass for the wrong reason.
    "put_verified": lambda: r2.put_verified("wisdom/probe/x.txt", b"x", "text/plain"),
    "get": lambda: r2.get("wisdom/probe/x.txt"),
    # list_prefix is a generator: the body runs only when it is consumed.
    "list_prefix": lambda: list(r2.list_prefix("wisdom/probe/")),
}


def test_the_exercised_set_matches_what_actually_reaches_the_bucket():
    reachers = _functions_that_reach_the_client()
    assert reachers, "AST found no bucket-reaching functions — the probe is broken, not r2.py"
    assert reachers == set(_EXERCISED), (
        "r2.py's bucket-reaching functions drifted from the set this file proves guarded: "
        f"unexercised={sorted(reachers - set(_EXERCISED))} "
        f"stale={sorted(set(_EXERCISED) - reachers)}"
    )


@pytest.mark.parametrize("name", sorted(_EXERCISED))
def test_every_public_door_refuses_under_pytest(name, monkeypatch):
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.invalid")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "uct-bars-snapshots")
    with pytest.raises(r2.R2TestIsolation):
        _EXERCISED[name]()


# ── the guard must never fire on the web pod ─────────────────────────────────

def test_the_predicate_is_false_for_a_pod_shaped_process(monkeypatch):
    """⛔ Direction safety. pytest is a PRODUCTION dependency here
    (requirements.txt) and api/ carries *_test.py modules, so a naive
    `"pytest" in sys.modules` predicate would arm this guard on the web pod and
    break real archiving. Both markers the predicate uses are absent there."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(r2.sys, "argv", ["/opt/venv/bin/uvicorn", "api.main:app"])
    assert r2._under_pytest() is False

    monkeypatch.setattr(r2.sys, "argv", ["/opt/venv/bin/python", "-m", "api.worker_main"])
    assert r2._under_pytest() is False


def test_the_predicate_is_true_for_both_pytest_entry_points(monkeypatch):
    """Control for the test above — it must be able to say yes."""
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(r2.sys, "argv", ["/opt/venv/bin/pytest", "tests/"])
    assert r2._under_pytest() is True

    monkeypatch.setattr(r2.sys, "argv", ["/opt/venv/lib/site-packages/pytest/__main__.py"])
    assert r2._under_pytest() is True


# ── the hermetic idiom still works ───────────────────────────────────────────

class _FakeBucket:
    """Mirrors the fixture the wisdom sources suites already use."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def head_object(self, Bucket, Key):
        raise _Missing()

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        self.objects[Key] = Body


class _Missing(Exception):
    response = {"Error": {"Code": "404"}}


def test_a_monkeypatched_client_is_unaffected_by_the_guard(monkeypatch):
    """The guard sits INSIDE _client_and_bucket, so replacing that function —
    the isolation idiom every wisdom suite uses — bypasses it entirely. If this
    ever goes red, the guard has been moved somewhere it breaks honest tests."""
    bucket = _FakeBucket()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (bucket, "fake"))

    out = r2.put_immutable("wisdom/probe/x.txt", b"hello", "text/plain")

    assert out["created"] is True
    assert bucket.objects == {"wisdom/probe/x.txt": b"hello"}
