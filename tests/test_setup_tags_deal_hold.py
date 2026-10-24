"""Setup tags obey the SAME deal hold as the member chart's drawings (auto_structures.deal_hold).

HZO (a price-pinned buyout, 2026-10-24): the member chart hid every drawing while its Setups list
still showed "Flat-Top Breakout". setup_tags.tags_for asked deal_hold(sym) without member=True, so
the clear price pin (deal_status.clear_pin, member-only) never reached the tags.

Pinned here: a member gets no tags and no setup lines on a clear price pin, the admin still gets
both, and a row already in the scan-time store cannot bypass the hold (it is applied when SERVING).

Synthetic bars only; no network, nothing under C:/data (the store is a tmp patterns.db).
"""
from __future__ import annotations

import pytest

from api.routers import patterns as patterns_router
from api.services import auto_structures, deal_status as ds, setup_tags as st
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_deal_clear_pin import deal_pin_bars, ep_tight_flag_bars, TODAY
from tests.test_member_drawing_set import _flags, _get, calls  # noqa: F401  (fixture)
from tests.test_setup_tags import _tag
from tests.test_setup_tags_store import _fixtures, _forbid_live

SYM = "ZZPN"
TEAM = [_tag("uct_kicker", "bullish"), _tag("uct_hve", "bearish"), _tag("uct_launch_pad_v4", "bullish")]


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("CATALYST_NEWS_DB_PATH", str(tmp_path / "none_catalyst.db"))
    monkeypatch.setenv("COMPANY_NEWS_DB_PATH", str(tmp_path / "none_company.db"))
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    monkeypatch.setenv("AUTO_STRUCTURES_SETUP_TAGS_ENABLED", "1")
    monkeypatch.setenv("DEAL_STATUS_ENABLED", "1")
    monkeypatch.setattr(ds, "_today", lambda: TODAY)
    monkeypatch.setattr(ds, "_delisted", lambda sym: False)
    monkeypatch.setattr(ds, "_clear_pin_candidates", lambda: frozenset())
    # not on any hand list or headline: ONLY the clear price pin can hold it
    monkeypatch.setattr(ds, "deal_status", lambda sym, bars=None: {
        "sym": sym, "pending": False, "possible": False, "source": [], "since": None,
        "price": None, "confidence": 0.0})
    monkeypatch.setattr(ds, "_bars_for", lambda sym: deal_pin_bars())
    ds.reset_cache()
    st._CACHE.clear()
    st._INFLIGHT.clear()
    yield
    ds.reset_cache()
    st._CACHE.clear()


def _team(monkeypatch):
    monkeypatch.setattr(st, "_team_tags_cached", lambda sym: [dict(t) for t in TEAM])


# -- tags_for: the member branch asks the member hold ---------------------------------------------

def test_a_member_gets_no_tags_on_a_clear_price_pin_and_the_admin_keeps_them(monkeypatch):
    _team(monkeypatch)
    assert auto_structures.deal_hold(SYM, member=True) is not None      # control: it IS pinned
    assert auto_structures.deal_hold(SYM) is None                        # control: team not held
    assert st.tags_for(SYM, member=True) == []
    assert [t["setup"] for t in st.tags_for(SYM, member=False)] == [t["setup"] for t in TEAM]


def test_a_member_keeps_tags_on_an_ep_flag_that_is_not_a_pin(monkeypatch):
    """Non-vacuity: the hold must not blank every member answer."""
    _team(monkeypatch)
    monkeypatch.setattr(ds, "_bars_for", lambda sym: ep_tight_flag_bars())
    assert [t["setup"] for t in st.tags_for(SYM, member=True)] == ["uct_kicker", "uct_launch_pad_v4"]


# -- the store: a stored row is held when SERVED, not only when computed --------------------------

def test_a_stored_row_cannot_bypass_the_member_hold(monkeypatch):
    fx = {k: v for k, v in _fixtures().items() if k.startswith("RW")}
    sym = next(s for s, bars in fx.items() if st.member_tags(st.compute_tags(s, bars)))
    bars = fx[sym]
    monkeypatch.setattr(st, "_completed_daily_bars", lambda s: [dict(b) for b in bars])
    res = st.record_store([sym])
    assert res["recorded"] == 1
    stored = st.stored_tags(sym, bars)
    assert stored and st.member_tags(stored), "control: the store holds member-visible tags"
    _forbid_live(monkeypatch)                     # served from the store, never recomputed
    assert st.tags_for(sym, member=True) == []
    assert st.tags_for(sym, member=False) == stored
    # and once the pin is gone the same stored row reaches the member again
    monkeypatch.setattr(ds, "_bars_for", lambda s: ep_tight_flag_bars())
    ds.reset_cache()
    assert st.tags_for(sym, member=True) == st.member_tags(stored)


# -- the route: confirmed_only setup_tags (the HZO path) and the setup lines ----------------------

@pytest.fixture
def no_verdicts(monkeypatch):
    from api.services.pattern_vision import store as pv
    monkeypatch.setattr(pv, "init_db", lambda: None)
    monkeypatch.setattr(pv, "get_confirmed", lambda sym, tf: [])
    monkeypatch.setattr(pv, "count_evaluated", lambda sym, tf: 0)
    monkeypatch.setattr(pv, "last_judged_at", lambda sym, tf: None)


def test_route_setups_list_is_empty_for_a_member_on_a_pin_and_full_for_the_admin(monkeypatch, no_verdicts):
    _team(monkeypatch)
    url = f"/api/patterns/{SYM}?tf=D&confirmed_only=true"
    assert _get(PAID_MEMBER, url).json()["setup_tags"] == []
    assert [t["setup"] for t in _get(ADMIN, url).json()["setup_tags"]] == [t["setup"] for t in TEAM]


def test_route_member_gets_no_setup_lines_on_a_pin_and_the_admin_keeps_them(monkeypatch, calls):
    _flags(monkeypatch, True, True)
    line = [{"pattern_id": "draw:remount", "geometry": {"lines": []}}]
    monkeypatch.setattr(auto_structures, "setup_draws_for", lambda sym, member=False: list(line))
    url = f"/api/patterns/{SYM}?tf=D&confirmed_only=false&include_structures=true"
    member = _get(PAID_MEMBER, url).json()
    assert "setup_draws" not in member and member["detections"] == []
    assert member["deal_status"]["label"] == ds.CLEAR_PIN_LABEL
    admin = _get(ADMIN, url).json()
    assert admin.get("setup_draws") == line and "deal_status" not in admin
    # control: without the pin the member path does serve the setup lines
    monkeypatch.setattr(ds, "_bars_for", lambda sym: ep_tight_flag_bars())
    ds.reset_cache()
    assert _get(PAID_MEMBER, url).json().get("setup_draws") == line
