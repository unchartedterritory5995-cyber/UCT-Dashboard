"""Every member of every prebuilt list must be a symbol that paints.

INCIDENT 2026-11-11: the prebuilt S&P 100 held HONAV -- the temporary
WHEN-ISSUED line (Nasdaq fifth letter `V`) copied out of an OEF holdings file around a
spin-off. It stopped trading, so every chart of it answered 503 `cold-bg` with 0 bars;
VSNTV (S&P 600) and ANGIV (Russell 2000) were the same defect. Rails:
  1. The COMMITTED seed holds only resolvable members (no when-issued lines).
  2. The fetch door maps a when-issued line to its regular listing, de-duplicated.
  3. An overlay written before (2) still SERVES the regular listing.
  4. The monthly refresh keeps only members that actually traded.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services import index_constituents as ic

SEED = Path(__file__).resolve().parents[1] / "api" / "data" / "prebuilt_lists.json"


@pytest.fixture(autouse=True)
def _clean_memo():
    from api.services import watchlist_prebuilt as wp
    wp.invalidate_prebuilt_config_cache()
    yield
    wp.invalidate_prebuilt_config_cache()


def test_committed_prebuilt_members_all_resolve():
    from api.services import watchlist_prebuilt as wp
    lists = json.loads(SEED.read_text(encoding="utf-8"))
    assert len(lists) >= 10 and sum(len(l["tickers"]) for l in lists) > 3000   # the probe read data
    bad = {l["name"]: [t for t in l["tickers"]
                       if not wp._is_synthetic_ticker(t) and not ic.is_resolvable_member(t)]
           for l in lists}
    bad = {k: v for k, v in bad.items() if v}
    assert not bad, f"prebuilt members that can never paint: {bad}"


@pytest.mark.parametrize("raw,want", [
    ("HONAV", "HONA"), ("VSNTV", "VSNT"), ("ANGIV", "ANGI"), ("honav", "HONA"),
    ("HON", "HON"), ("BRK-B", "BRK-B"), ("MOG-A", "MOG-A"), ("V", "V"), ("NVDA", "NVDA"),
    ("GOOGL", "GOOGL"), ("TV", "TV"), ("CVV", "CVV"),
])
def test_normalize_member(raw, want):
    assert ic.normalize_member(raw) == want
    assert ic.is_resolvable_member(want)


def test_fetch_door_maps_when_issued_and_dedupes(monkeypatch):
    rows = [{"asset": a} for a in ("AAPL", "HONAV", "HONA", "BIPC.TO", "", "MSFT", "honav")]
    monkeypatch.setattr(ic, "_get", lambda _url: rows)
    assert ic._fetch_one("holdings", "OEF", "k") == ["AAPL", "HONA", "MSFT"]


def test_stale_overlay_still_serves_the_regular_listing(monkeypatch):
    from api.services import watchlist_prebuilt as wp
    monkeypatch.setattr(wp, "_load_committed_uncached", lambda: [
        {"name": "S&P 100", "desc": "", "category": ic.CATEGORY, "tickers": ["AAPL", "HONA"]},
    ])
    monkeypatch.setattr(wp, "_read_overlay", lambda: {
        "index_constituents": {"s&p 100": ["AAPL", "HONAV", "MSFT"]}})
    assert wp._load_lists()[0]["tickers"] == ["AAPL", "HONA", "MSFT"]


def test_refresh_keeps_only_members_that_trade(monkeypatch, tmp_path):
    from api.services import watchlist_prebuilt as wp
    from api.services import watchlist_prebuilt_refresh as wr
    monkeypatch.setattr(wr, "_key", lambda: "k")
    dvol = {f"E{i}": 1.0 for i in range(400)}          # liquid ETFs (pass the thin guards)
    dvol.update({"AAPL": 9.0, "BRK.B": 5.0, "HON": 3.0})
    monkeypatch.setattr(wr, "_grouped_recent_days", lambda _k, _n: [("2026-11-10", dvol)])
    monkeypatch.setattr(wr, "_paginate", lambda _u, _k, cap=400: [
        {"ticker": t, "name": "Fund"} for t in dvol if t.startswith("E")])
    monkeypatch.setattr(wr, "_MIN_LIQUID", 1, raising=False)
    monkeypatch.setattr(wr, "_MIN_ALIVE", 1, raising=False)
    monkeypatch.setattr(ic, "fetch_index_lists",
                        lambda key=None: {"S&P 100": ["AAPL", "BRK-B", "HON", "GONEX"]})
    monkeypatch.setattr(wp, "_OVERLAY_PATH", str(tmp_path / "overlay.json"))
    monkeypatch.setattr(wp, "_read_overlay", lambda: {})
    out = wr.refresh_prebuilt_lists(apply=False)
    assert out["ok"], out
    written = json.loads((tmp_path / "overlay.json").read_text(encoding="utf-8"))
    assert sorted(written["index_constituents"]["s&p 100"]) == ["AAPL", "BRK-B", "HON"]
