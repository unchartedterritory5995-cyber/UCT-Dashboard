"""Gap 1 — the artifact cache wired to the hot path, and OI-32's stand-in refusal.

⛔⛔ WHY A SEPARATE FILE FROM `test_discord_render_artifact_cache.py`. That suite proves the STORE
behaves; this one proves the RENDER PATH CALLS IT. Those are different claims, and this programme
has shipped the first without the second twice — `breakers.py` and `freshness.py` were both built,
tested, green and reachable by nobody until the adapters became their first real consumer. A
component test is structurally blind to a severed wire (`lesson_built_tested_green_and_unreachable`).

⛔ THE LOAD-BEARING TEST IS `test_with_the_flag_off_the_render_path_is_byte_for_byte_what_it_was`.
Everything else here is about the cache working; that one is about the cache being ABSENT when it
is supposed to be, which is the property the whole flag rests on.
"""
from __future__ import annotations

import pytest

from api.services.discord_render import artifact_cache as ac
from api.services.discord_render import freshness as fr
from api.services.discord_render.adapters import bindings

PNG = b"\x89PNG\r\n\x1a\n" + b"house"


class Job:
    corr_id = "cache0001"
    command = "chart"


class Ctx:
    def __init__(self, budget_s: float = 12.0):
        self.job = Job()
        self._budget = budget_s

    def remaining_s(self):
        return self._budget


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """⛔ A SANDBOXED L2. `/data` is a real directory on this box; a cache test that reaches it
    writes the owner's live files."""
    monkeypatch.setenv("DISCORD_RENDER_CACHE_DIR", str(tmp_path / "l2"))
    monkeypatch.setenv("DISCORD_RENDER_V2_ADAPTERS_ENABLED", "1")
    monkeypatch.setattr(ac, "_DEFAULT", None, raising=False)
    yield
    monkeypatch.setattr(ac, "_DEFAULT", None, raising=False)


def _render_fn(ctx, calls: list, payload=PNG):
    def inner(sym, tf, stats, opts=None):
        calls.append((sym, tf))
        return payload
    return bindings.house_fn(ctx, inner=inner)


# ── the flag ────────────────────────────────────────────────────────────────

def test_with_the_flag_off_the_render_path_is_byte_for_byte_what_it_was(monkeypatch):
    """⛔⛔ NOT "a lookup that misses" — NOTHING. No key computed, no store touched.

    A gate that still does the cheap part is a gate that has already changed the thing it gates,
    and the difference only shows up as a latency nobody attributes. The store is replaced with one
    that FAILS on any access, so "the flag is off" is measured rather than assumed."""
    monkeypatch.delenv("RENDER_CACHE_ENABLED", raising=False)

    def _no_store():
        pytest.fail("the cache was consulted with RENDER_CACHE_ENABLED unset")
    monkeypatch.setattr(ac, "store", _no_store)

    calls: list = []
    out = _render_fn(Ctx(), calls)("NVDA", "D", {}, {})
    assert out == PNG and calls == [("NVDA", "D")]


def test_with_the_flag_on_a_second_identical_render_is_served_from_the_cache(monkeypatch):
    monkeypatch.setenv("RENDER_CACHE_ENABLED", "1")
    calls: list = []
    fn = _render_fn(Ctx(), calls)
    assert fn("NVDA", "D", {}, {}) == PNG
    assert fn("NVDA", "D", {}, {}) == PNG
    assert calls == [("NVDA", "D")], f"the renderer ran twice for one key: {calls}"


def test_a_different_timeframe_is_a_different_entry(monkeypatch):
    monkeypatch.setenv("RENDER_CACHE_ENABLED", "1")
    calls: list = []
    fn = _render_fn(Ctx(), calls)
    fn("NVDA", "D", {}, {})
    fn("NVDA", "5", {}, {})
    assert len(calls) == 2, "two timeframes collapsed into one cache entry"


def test_a_render_option_that_changes_the_picture_changes_the_key(monkeypatch):
    monkeypatch.setenv("RENDER_CACHE_ENABLED", "1")
    calls: list = []
    fn = _render_fn(Ctx(), calls)
    fn("NVDA", "D", {}, {"darkpool": False})
    fn("NVDA", "D", {}, {"darkpool": True})
    assert len(calls) == 2, "the dark-pool overlay was served from the plain chart's entry"


def test_an_option_that_does_not_change_the_picture_does_not_split_the_key(monkeypatch):
    """⛔ THE OPPOSITE FAILURE, AND IT IS INVISIBLE. Keying on the whole options dict gives every
    member their own entry — a 0 % hit rate that every test still passes."""
    monkeypatch.setenv("RENDER_CACHE_ENABLED", "1")
    calls: list = []
    fn = _render_fn(Ctx(), calls)
    fn("NVDA", "D", {}, {"requested_by": "member-1"})
    fn("NVDA", "D", {}, {"requested_by": "member-2"})
    assert len(calls) == 1, f"a per-member field reached the cache key: {calls}"


# ── the vintage is in the key, which is what makes a hit need no label ──────

def test_a_new_vintage_is_a_new_entry_so_a_hit_can_never_serve_yesterdays_chart(monkeypatch):
    """⛔⛔ THE PROPERTY THE WHOLE DESIGN RESTS ON. A cache hit carries no freshness label precisely
    because the vintage is part of the key; if that stops being true, the cache serves yesterday's
    picture under today's badge and the label says nothing is wrong."""
    monkeypatch.setenv("RENDER_CACHE_ENABLED", "1")
    calls: list = []
    ctx = Ctx()
    fn = _render_fn(ctx, calls)

    def _with_vintage(as_of):
        env = fr.envelope(as_of, tf="D", provider="disk")
        bindings.record(ctx, "bars", _ok_result(env))
        return fn("NVDA", "D", {}, {})

    _with_vintage("2026-09-11")
    _with_vintage("2026-09-12")
    assert len(calls) == 2, "two different data vintages shared one cache entry"


def _ok_result(envelope):
    from api.services.discord_render.adapters import result as R
    return R.ok([{"t": "2026-09-11"}], provider="bars", envelope=envelope)


# ── OI-32 ───────────────────────────────────────────────────────────────────

def test_a_stand_in_is_never_stored_by_either_tier():
    """OI-32 — owner ruling. C-06 measured three stand-ins and **two never healed**; caching one
    serves it to everybody for a TTL, and the coalescer fans it out to every follower at once."""
    store = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA", "tf": "D"}, vintage="2026-09-11")
    store.put(key, ac.Artifact(data=PNG, is_standin=True))
    assert store.get(key) is None, "a stand-in was served from the cache"
    assert store.stats().get("refused_standin", 0) == 1, "the refusal was silent"


def test_the_volume_tier_refuses_a_stand_in_on_its_own(tmp_path):
    """⛔ THE GUARD CANNOT LIVE ONLY IN THE TIER ABOVE. L2 is reachable directly — the determinism
    runner does exactly that — so a refusal that only holds for callers who came the expected way
    is a guard that holds for the cases that were never the risk."""
    vol = ac.VolumeCache(str(tmp_path / "l2"))
    key = ac.key_for("chart", {"ticker": "NVDA", "tf": "D"}, vintage="2026-09-11")
    assert vol.put(key, ac.Artifact(data=PNG, is_standin=True)) is False
    assert vol.get(key) is None


def test_an_ordinary_artifact_is_still_stored_and_that_is_the_control():
    """Without this, both tests above would pass against a cache that stores nothing at all."""
    store = ac.ArtifactCache()
    key = ac.key_for("chart", {"ticker": "NVDA", "tf": "D"}, vintage="2026-09-11")
    store.put(key, ac.Artifact(data=PNG))
    got = store.get(key)
    assert got is not None and bytes(got.data) == PNG


# ── the wire itself ─────────────────────────────────────────────────────────

def test_the_render_path_actually_imports_the_cache(monkeypatch):
    """⛔ AN AST, NEVER A GREP — this module's comments discuss the cache at length. Mirrors
    `flip_preconditions.check_cache_wired`, which is what the flip gate reads."""
    import ast
    import pathlib
    src = pathlib.Path("api/services/discord_render/adapters/bindings.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    # ⚰️ THE FIRST VERSION READ ONLY `n.module` AND SO IT FAILED ON A CORRECTLY WIRED FILE.
    # `from api.services.discord_render import artifact_cache` puts the module's name in the
    # ALIAS, not in `n.module` — which is `api.services.discord_render`. The probe was asking a
    # question whose answer was always no, and `flip_preconditions` asked it the same wrong way,
    # so the flip gate would have reported "not wired" forever.
    imported = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    imported |= {a.name for n in ast.walk(tree)
                 if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
    assert any("artifact_cache" in (m or "") for m in imported), (
        "bindings does not import artifact_cache — 2.5 is built and unconnected again")
    # the control: prove the probe would notice the absence
    assert not any("a_module_that_does_not_exist" in (m or "") for m in imported)


# ── TTL rollover at the session change ──────────────────────────────────────

def test_an_entry_cached_in_one_session_does_not_outlive_the_session_change(monkeypatch):
    """⛔⛔ THE ROLLOVER IS THE MOMENT THE CACHE IS MOST LIKELY TO LIE. An RTH chart cached at
    15:59 must not still be served at 16:05 under the post-session's longer TTL — the picture was
    drawn from intraday bars that stopped moving, and the member asking after the close is asking a
    different question.

    ⭐ The boundary is held by TWO independent things, and this asserts both: the TTL shortens
    (`ttl_s`), and the VINTAGE in the key changes when the data does. Either alone would leave a
    window; asserting only the TTL would pass against a cache that keyed on the ticker alone."""
    import datetime as dt

    rth = dt.datetime(2026, 9, 14, 15, 59, tzinfo=fr.ET)
    post = dt.datetime(2026, 9, 14, 16, 5, tzinfo=fr.ET)
    assert fr.session_state(rth) == fr.RTH and fr.session_state(post) == fr.POST, (
        "the fixture instants are not the two sessions this test is about")

    rth_ttl, post_ttl = ac.ttl_s(fr.RTH), ac.ttl_s(fr.POST)
    assert rth_ttl is not None and post_ttl is not None
    assert rth_ttl < post_ttl, (
        f"RTH ({rth_ttl}s) is not the shorter TTL — an intraday chart would be held for the "
        f"post-session's {post_ttl}s across the close")

    # the second half: a new intraday bar is a new vintage, so the key moves with the data
    a = ac.key_for("chart", {"ticker": "NVDA", "tf": "5"},
                   vintage=ac.vintage_of(fr.envelope("2026-09-14 15:55:00", tf="5",
                                                     provider="disk", now=rth)))
    b = ac.key_for("chart", {"ticker": "NVDA", "tf": "5"},
                   vintage=ac.vintage_of(fr.envelope("2026-09-14 16:00:00", tf="5",
                                                     provider="disk", now=post)))
    assert a != b, "two different intraday vintages share one cache key across the close"
