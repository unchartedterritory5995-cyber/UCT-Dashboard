"""The warm cache must survive a deploy WITHOUT extending any value's life.

`api/services/cache_snapshot.py` exists because the in-memory TTLCache resets on
every deploy, leaving ~3.5 minutes where users pay the cold recomputes the
warmers exist to prevent. Holding traffic back instead is not available — that
was tried on 2026-07-26 and took the site down (see api/services/readiness.py).

The danger in carrying a cache across a restart is SILENT: everything still
renders, just from data that should have expired. So the load-bearing assertion
here is not "the value came back" but "it came back with the life it had LEFT".
"""
from __future__ import annotations

import json
import os
import time

import pytest

from api.services.cache import TTLCache
from api.services import cache_snapshot as cs


@pytest.fixture
def snap_path(tmp_path):
    return str(tmp_path / "cache_snapshot.json")


def test_a_restart_does_not_extend_a_value_s_life(snap_path, monkeypatch):
    """THE correctness claim: restore carries the REMAINING ttl, not the original.

    A naive implementation re-inserts with the original duration, which quietly
    resurrects data for a full extra TTL on every deploy. Nothing looks broken —
    the numbers are just older than the cache contract promises.
    """
    src = TTLCache()
    src.set("regime", {"phase": "green"}, ttl=100.0)

    # 90s pass, then the pod restarts.
    later = time.time() + 90.0
    cs.save(src, snap_path)

    dst = TTLCache()
    # ⚠️ `cs.time` IS the stdlib module, so patching it is GLOBAL. Capture the
    # real function first (a lambda that calls time.time() after patching
    # recurses into itself) and let monkeypatch put it back.
    _real = time.time
    monkeypatch.setattr(cs.time, "time", lambda: later)
    try:
        cs.restore(dst, snap_path)
    finally:
        monkeypatch.setattr(cs.time, "time", _real)

    got = dst.items_with_expiry()
    assert len(got) == 1, "the entry should have been carried over"
    _, value, expires_at = got[0]
    assert value == {"phase": "green"}
    remaining = expires_at - later
    assert 0 < remaining <= 11, (
        f"restored with {remaining:.1f}s of life; only ~10s remained. A restart "
        "must not extend a value's lifetime."
    )


def test_an_entry_that_died_while_the_pod_was_down_is_dropped(snap_path, monkeypatch):
    src = TTLCache()
    src.set("short", "gone", ttl=30.0)
    cs.save(src, snap_path)

    dst = TTLCache()
    _real = time.time
    then = _real() + 120.0                     # outlived its ttl
    monkeypatch.setattr(cs.time, "time", lambda: then)
    try:
        stats = cs.restore(dst, snap_path)
    finally:
        monkeypatch.setattr(cs.time, "time", _real)

    assert stats["restored"] == 0
    assert stats["expired"] == 1
    assert dst.get("short") is None, "an expired value must never come back"


def test_round_trip_carries_the_expensive_aggregates(snap_path):
    src = TTLCache()
    src.set("rs_scores", {"NVDA": 98, "AMD": 71}, ttl=3600.0)
    src.set("themes", [{"t": "AI", "pct": 1.2}], ttl=1800.0)

    saved = cs.save(src, snap_path)
    assert saved["written"] == 2

    dst = TTLCache()
    cs.restore(dst, snap_path)
    assert dst.get("rs_scores") == {"NVDA": 98, "AMD": 71}
    assert dst.get("themes") == [{"t": "AI", "pct": 1.2}]


def test_megabyte_payloads_are_skipped(snap_path):
    """bars_* payloads have their own disk cache; carrying them here is waste."""
    src = TTLCache()
    src.set("bars_NVDA_D_5000", ["x" * 1000] * 500, ttl=3600.0)   # well over the cap
    src.set("small", {"ok": True}, ttl=3600.0)

    stats = cs.save(src, snap_path)
    assert stats["skipped_big"] == 1
    assert stats["written"] == 1

    dst = TTLCache()
    cs.restore(dst, snap_path)
    assert dst.get("small") == {"ok": True}
    assert dst.get("bars_NVDA_D_5000") is None


def test_unserializable_values_are_skipped_not_fatal(snap_path):
    src = TTLCache()
    src.set("obj", object(), ttl=3600.0)
    src.set("fine", {"a": 1}, ttl=3600.0)

    stats = cs.save(src, snap_path)
    assert stats["written"] == 1, "one good entry must still be saved"

    dst = TTLCache()
    cs.restore(dst, snap_path)
    assert dst.get("fine") == {"a": 1}


def test_a_nearly_expired_entry_is_not_carried(snap_path):
    """It would die during the boot it was meant to accelerate."""
    src = TTLCache()
    src.set("blink", 1, ttl=1.0)
    stats = cs.save(src, snap_path)
    assert stats["written"] == 0
    assert stats["skipped_expiring"] == 1


# ── failure modes must degrade to "cold boot", never to "failed boot" ────────


def test_a_missing_snapshot_is_silent(tmp_path):
    dst = TTLCache()
    stats = cs.restore(dst, str(tmp_path / "nope.json"))
    assert stats == {"found": 0, "restored": 0, "expired": 0, "age_seconds": None}


def test_a_truncated_snapshot_does_not_raise(snap_path):
    with open(snap_path, "w", encoding="utf-8") as f:
        f.write('{"version":1,"entries":{"a":[1,')   # cut mid-write
    dst = TTLCache()
    stats = cs.restore(dst, snap_path)          # must not raise
    assert stats["restored"] == 0


def test_an_unknown_snapshot_version_is_refused(snap_path):
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump({"version": 999, "entries": {"a": [1, time.time() + 60]}}, f)
    dst = TTLCache()
    assert cs.restore(dst, snap_path)["restored"] == 0
    assert dst.get("a") is None


def test_save_is_atomic_and_leaves_no_temp_files(snap_path):
    """A crash mid-dump must not leave a zero-byte snapshot.

    `open(path, "w")` truncates before the write can fail, which would turn a
    crash into a silently cold next boot. Assert the real file lands whole and
    the directory is clean.
    """
    src = TTLCache()
    src.set("k", {"v": 1}, ttl=600.0)
    cs.save(src, snap_path)

    d = os.path.dirname(snap_path)
    leftovers = [n for n in os.listdir(d) if n.startswith(".cache_snapshot.")]
    assert not leftovers, f"temp files left behind: {leftovers}"

    with open(snap_path, encoding="utf-8") as f:
        payload = json.load(f)          # must parse: proof it is whole
    assert payload["version"] == 1
    assert "k" in payload["entries"]


def test_save_over_an_existing_snapshot_replaces_it_wholly(snap_path):
    src = TTLCache()
    src.set("first", "a" * 500, ttl=600.0)
    cs.save(src, snap_path)

    src2 = TTLCache()
    src2.set("second", "b", ttl=600.0)
    cs.save(src2, snap_path)

    dst = TTLCache()
    cs.restore(dst, snap_path)
    assert dst.get("second") == "b"
    assert dst.get("first") is None, "stale keys from the previous snapshot leaked"


def test_items_with_expiry_filters_expired_entries():
    """The accessor owns the staleness rule so callers never re-implement it."""
    c = TTLCache()
    c.set("live", 1, ttl=600.0)
    c.set("dead", 2, ttl=600.0)
    # Force one entry's deadline into the past without touching the clock.
    with c._lock:                      # noqa: SLF001 - deliberate, this is the unit under test
        v, _ = c._store["dead"]
        c._store["dead"] = (v, time.time() - 1)

    keys = {k for k, _, _ in c.items_with_expiry()}
    assert keys == {"live"}


# ── THE WIRE ────────────────────────────────────────────────────────────────
# Everything above passes if this module is never called. That is the exact
# failure this repo keeps rediscovering — and it happened twice in the session
# that wrote this file (a slim-mode flag the router never forwarded; a readiness
# gate four files claimed was wired and wasn't). So the wiring gets its own AST
# rails over api/main.py, with controls proving the probe can discriminate.


def _main_src():
    import pathlib
    return (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(
        encoding="utf-8"
    )


def _calls_in(src, dotted):
    """Does the source contain a call to `<obj>.<attr>`? (AST, never a grep.)"""
    import ast
    obj, attr = dotted.split(".")
    tree = ast.parse(src)
    for n in ast.walk(tree):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == attr
                and isinstance(n.func.value, ast.Name) and n.func.value.id == obj):
            return True
    return False


def test_main_restores_the_snapshot_and_saves_it_on_shutdown():
    src = _main_src()
    assert _calls_in(src, "cache_snapshot.restore"), (
        "api/main.py never calls cache_snapshot.restore() — the pod still boots "
        "cold and this whole module is dead code"
    )
    assert _calls_in(src, "cache_snapshot.save"), (
        "api/main.py never calls cache_snapshot.save() on shutdown — the next "
        "pod has nothing to restore"
    )
    # Control: the probe must not report a call that isn't there.
    assert not _calls_in(src, "cache_snapshot.definitely_not_a_real_function")


def test_the_periodic_save_job_is_registered():
    """A shutdown-only save is lost to an OOM kill or a crash."""
    import ast
    tree = ast.parse(_main_src())
    ids = set()
    for n in ast.walk(tree):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "add_job"):
            for kw in n.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    assert "cache_snapshot_save" in ids, (
        f"no add_job(id='cache_snapshot_save') in api/main.py; found {len(ids)} job ids"
    )
    # Control: the probe genuinely reads this file's job ids, so a missing one
    # is a real absence rather than a broken walker.
    assert len(ids) > 50, f"job-id probe only found {len(ids)} ids — not discriminating"


def test_restore_happens_before_the_app_starts_serving():
    """A restore that ran AFTER the warmers would accelerate nothing.

    The whole value is that the pod is warm the moment it takes traffic, so the
    restore must appear in the lifespan BEFORE the warm threads are scheduled.
    """
    src = _main_src()
    restore_at = src.index("cache_snapshot.restore")
    # The first warm thread the readiness gate tracks.
    warm_at = src.index('readiness.register("hot_tier")')
    assert restore_at < warm_at, (
        "cache_snapshot.restore() runs after the warmers are scheduled — by then "
        "the cold window has already opened"
    )
