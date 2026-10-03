"""TERM-018: the two flow-worker missed-slot pages (G-22 cream EOD, G-23 OI morning),
observed TWO-SIDED.

Both `_alert_missed` guards were "PROVEN, one-sided": the catch-up suites drive the
page with an injected clock but nothing showed a late-but-still-honest catch-up
pages NOBODY, and nothing pinned the severity beyond one assert. These rails drive
each module's real `catch_up` (only the card builder and the sink replaced) on
both sides of its own grace window - read from the module, never retyped.

The state file goes to a TMP path, never `/data` (the owner's live volume).
"""
from __future__ import annotations

import datetime as dt

import pytest

from api import cream_card as cc
from api import oi_morning as oim

ET = dt.timezone(dt.timedelta(hours=-4))


def _at(mod, minutes_after_slot: int) -> dt.datetime:
    h, m = mod.SLOT_ET
    # 2026-09-08 is a Tuesday.
    return dt.datetime(2026, 9, 8, h, m, tzinfo=ET) + dt.timedelta(minutes=minutes_after_slot)


def _grace(mod) -> int:
    return mod._grace_min() if mod is cc else mod.CATCHUP_GRACE_MIN


@pytest.fixture(params=["cream", "oi"])
def rig(request, tmp_path, monkeypatch):
    if request.param == "cream":
        mod, builder = cc, "run_cream_eod"
        monkeypatch.setenv("CREAM_EOD_STATE_PATH", str(tmp_path / "cream_state.json"))
        monkeypatch.setenv("CREAM_EOD_ENABLED", "1")
    else:
        mod, builder = oim, "run_oi_morning"
        monkeypatch.setenv("OI_MORNING_STATE_PATH", str(tmp_path / "oi_state.json"))
        monkeypatch.setenv("OI_MORNING_ENABLED", "1")
    posted = []
    monkeypatch.setattr(mod, builder,
                        lambda **kw: posted.append(kw) or {"ok": True, "posted": True})
    pages = []
    import api.services.chart_health_alerts as cha
    monkeypatch.setattr(cha, "emit",
                        lambda key, sev, msg, meta=None: pages.append((key, sev, msg)))
    return mod, posted, pages


def test_a_slot_missed_past_its_window_PAGES_critical(rig):
    mod, posted, pages = rig
    mod.catch_up(now=_at(mod, _grace(mod) + 30))
    assert posted == []
    assert [s for _, s, _ in pages] == ["critical"], pages
    assert "2026-09-08" in pages[0][0]


def test_CONTROL_a_late_slot_still_inside_its_window_pages_NOBODY(rig):
    """The guard's other side: an honest catch-up is a post, not an incident."""
    mod, posted, pages = rig
    mod.catch_up(now=_at(mod, _grace(mod)))
    assert len(posted) == 1
    assert pages == []


def test_a_missed_slot_pages_ONCE_per_day(rig):
    mod, posted, pages = rig
    mod.catch_up(now=_at(mod, _grace(mod) + 30))
    mod.catch_up(now=_at(mod, _grace(mod) + 31))
    assert len(pages) == 1
