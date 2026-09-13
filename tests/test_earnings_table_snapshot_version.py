"""A snapshot written by older code must not be served as if it were current.

⚰️ FOUND IN PRODUCTION, 2026-09-12, minutes after deploying the staleness work.
The code was live — `/api/admin/fundamentals-health` carried the new keys — and
the member-facing payload was still wrong:

    GET /api/fundamentals/earnings-table?sym=MMC
      reported_through: None   stale_quarters: None
      REP 2025 Q4 ... FWD 2026 Q2 ...

MMC's persistent snapshot had been written by the PREVIOUS build. It passes
`_snapshot_is_complete` (annual rows present, reported quarters present), and it
was still inside its TTL, so the serve path returned it verbatim and scheduled
no rebuild. Members would have kept the eight-month-old quarter for up to
`_SLOW_TTL` (6h) — and the two new payload fields read as None, which is
exactly what a stale shape looks like from the outside.

⛔ **Changing the payload shape or the quarterly-strip composition is a cache
invalidation event.** This is the same rule `barsIDB.CACHE_LOGIC_VERSION` exists
for on the browser side, and the same failure the repo's own notes describe
there: the delta path can only ADD, so a payload stored in the old shape can
never heal into the new one by being refreshed in place.

⭐ And the deploy looked GREEN the whole time. The build succeeded, uptime reset,
the admin endpoint proved the new code was running. Verifying the CODE is live is
not verifying the ANSWER changed.
"""
import importlib

import pytest


@pytest.fixture()
def et(monkeypatch):
    import api.services.earnings_table as m
    importlib.reload(m)
    return m


def _payload(**extra):
    p = {
        "ticker": "MMC",
        "annual": [{"year": 2025, "eps": 8.1, "sales": 2.4e10}],
        "quarterly": [{"label": "2025 Q4", "reported": True}],
    }
    p.update(extra)
    return p


# ── the version stamp exists and rides the payload ───────────────────────────
def test_a_built_payload_carries_the_current_version(et, monkeypatch):
    monkeypatch.setattr(et, "_build_quarterly",
                        lambda t, now, fresh=False: [{"label": "2026 Q2", "reported": True}])
    monkeypatch.setattr(et, "get_annual_financials_fn", lambda t, now: [{"year": 2025}])
    monkeypatch.setattr(et, "_is_fresh_window", lambda t, now: False)
    out, _ = et._build("MMC", 1_780_000_000.0)
    assert out["_v"] == et._PAYLOAD_VERSION


def test_the_version_is_an_int_so_it_can_be_compared_and_bumped(et):
    assert isinstance(et._PAYLOAD_VERSION, int) and et._PAYLOAD_VERSION >= 2


# ── the discriminator ─────────────────────────────────────────────────────────
def test_a_payload_from_an_older_build_is_not_current(et):
    # The real MMC shape: complete by every structural measure, written before
    # the staleness fields existed.
    old = _payload()
    assert "_v" not in old
    assert et._snapshot_is_complete(old) is True, "still structurally complete"
    assert et._snapshot_is_current(old) is False, "but NOT current — must rebuild"


def test_a_payload_from_a_future_build_is_not_current(et):
    # A rollback must not serve a newer shape it cannot read.
    assert et._snapshot_is_current(_payload(_v=et._PAYLOAD_VERSION + 1)) is False


def test_a_current_payload_is_current(et):
    assert et._snapshot_is_current(_payload(_v=et._PAYLOAD_VERSION)) is True


# ── the serve path must honour it ─────────────────────────────────────────────
def _serve_with(monkeypatch, et, stored, age):
    """Wire a FRESH-by-TTL stored snapshot and report whether the serve path
    returned it or rebuilt instead."""
    monkeypatch.setattr(et.cache, "get", lambda k: None)
    monkeypatch.setattr(et.cache, "set", lambda k, v, ttl=None, **kw: None)
    monkeypatch.setattr(et.snap_store, "get",
                        lambda kind, t, now=None: (stored, age, 21600))
    built = {"n": 0}

    def _rebuild(ticker, now=None):
        built["n"] += 1
        return {"ticker": ticker, "rebuilt": True}

    monkeypatch.setattr(et, "_build_and_cache", _rebuild)
    monkeypatch.setattr(et, "_schedule_refresh", lambda t: None)
    out = et.get_earnings_table("MMC")
    return out, built["n"]


def test_a_stale_shape_inside_its_ttl_is_rebuilt_not_served(monkeypatch, et):
    """The exact production bug. age(60) is well inside ttl(21600), so the old
    code returned the stored payload and scheduled nothing."""
    out, rebuilds = _serve_with(monkeypatch, et, _payload(), age=60)
    assert rebuilds == 1, "an old-shape snapshot was served instead of rebuilt"
    assert out.get("rebuilt") is True


def test_a_current_shape_inside_its_ttl_is_still_served_from_disk(monkeypatch, et):
    """The cost control this must not break: a current snapshot still serves
    instantly, which is the whole point of the persistent store."""
    stored = _payload(_v=et._PAYLOAD_VERSION)
    out, rebuilds = _serve_with(monkeypatch, et, stored, age=60)
    assert rebuilds == 0, "a current snapshot triggered a needless rebuild"
    assert out["ticker"] == "MMC" and "rebuilt" not in out


# ── the memory layer needs the same gate as the disk layer ───────────────────
def _serve_from_memory(monkeypatch, et, pinned):
    """Wire a MEMORY-cache hit and report whether it was served or rebuilt."""
    monkeypatch.setattr(et.cache, "get", lambda k: pinned)
    monkeypatch.setattr(et.cache, "set", lambda k, v, ttl=None, **kw: None)
    monkeypatch.setattr(et.cache, "invalidate", lambda k: None, raising=False)
    monkeypatch.setattr(et.snap_store, "get", lambda kind, t, now=None: None)
    built = {"n": 0}

    def _rebuild(ticker, now=None):
        built["n"] += 1
        return {"ticker": ticker, "rebuilt": True, "_v": et._PAYLOAD_VERSION}

    monkeypatch.setattr(et, "_build_and_cache", _rebuild)
    out = et.get_earnings_table("SJW")
    return out, built["n"]


def test_a_stale_shape_pinned_in_MEMORY_is_rebuilt_not_served(monkeypatch, et):
    """⚰️ The other half of the 2026-09-12 bug, and the first fix missed it.

    `_snapshot_is_current` was wired into the DISK branch only, while the serve
    path reads the in-memory TTLCache FIRST and returned it unconditionally:

        hit = cache.get(ckey)
        if hit is not None:
            return hit          # <- no version check

    So a payload pinned in memory in the old shape kept serving for up to
    `_SLOW_TTL` (6h) with the version gate live and doing nothing for it. Caught
    in production by a watcher polling SJW's member payload: every other ticker
    reported `_v=2` within minutes while SJW sat at `_v=None` for twenty.

    ⭐ Gating the slower layer and not the faster one is worse than gating
    neither, because the fix LOOKS present — the constant is there, the disk
    branch honours it, and the tests for that branch pass.
    """
    stale = _payload()                      # correct-looking, no _v
    out, rebuilds = _serve_from_memory(monkeypatch, et, stale)
    assert rebuilds == 1, "an old-shape MEMORY entry was served instead of rebuilt"
    assert out.get("_v") == et._PAYLOAD_VERSION


def test_a_current_shape_in_memory_is_still_served(monkeypatch, et):
    """The hot path must stay hot: a current memory entry serves with no
    rebuild, which is the whole reason the layer exists."""
    out, rebuilds = _serve_from_memory(monkeypatch, et, _payload(_v=et._PAYLOAD_VERSION))
    assert rebuilds == 0, "a current memory entry triggered a needless rebuild"
    assert "rebuilt" not in out
