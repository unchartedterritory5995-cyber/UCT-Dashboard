"""Dark Pool %ADV big-block alerts — pct math, absolute + %ADV floors, per-day dedup."""
import sqlite3

import pytest

from api import darkpool_bigblock as bb


def test_pct_adv_math():
    # 100k shares ($4M / $40) against 1M avg daily shares = 10%.
    assert bb.pct_adv(4_000_000, 40.0, 1_000_000) == pytest.approx(10.0)
    # guards → None when a factor can't support the ratio.
    assert bb.pct_adv(4_000_000, 0, 1_000_000) is None
    assert bb.pct_adv(4_000_000, 40.0, 0) is None
    assert bb.pct_adv(0, 40.0, 1_000_000) is None
    assert bb.pct_adv(None, None, None) is None


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    db = str(tmp_path / "dp.db")
    monkeypatch.setattr(bb, "_conn", lambda: sqlite3.connect(db))
    monkeypatch.setattr(bb, "_is_etf", lambda tk: False)  # no ETFs unless a test overrides
    return db


def _fake_daily_stats(avg50_by_ticker):
    def _f(tk):
        return {"avg50": avg50_by_ticker.get((tk or "").upper(), 0.0), "close": 0.0}
    return _f


def _patch_stats(monkeypatch, avg50_by_ticker):
    import api.darkpool_eod as eod
    monkeypatch.setattr(eod, "_daily_stats", _fake_daily_stats(avg50_by_ticker))


def test_evaluate_floor_and_adv(temp_db, monkeypatch):
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_PCT_ADV", "5")
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_MIN_NOTIONAL", "4e6")
    _patch_stats(monkeypatch, {"AAA": 1_000_000, "BBB": 1_000_000, "CCC": 100_000_000})
    prints = [
        ("AAA", 6_000_000, 40.0, "2026-08-14"),   # 150k sh / 1M   = 15%  → fire
        ("BBB", 4_000_000, 400.0, "2026-08-14"),  # 10k sh / 1M    = 1%   → below 5%, skip
        ("CCC", 5_000_000, 50.0, "2026-08-14"),   # 100k sh / 100M = 0.1% → skip
        ("DDD", 3_000_000, 30.0, "2026-08-14"),   # below the $4M floor   → skip
    ]
    events = bb._evaluate(prints)
    assert {e["ticker"] for e in events} == {"AAA"}
    assert events[0]["pct_adv"] == pytest.approx(15.0)


def test_evaluate_dedup_and_bigger(temp_db, monkeypatch):
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_PCT_ADV", "5")
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_MIN_NOTIONAL", "4e6")
    _patch_stats(monkeypatch, {"AAA": 1_000_000})
    d = "2026-08-14"
    assert len(bb._evaluate([("AAA", 6_000_000, 40.0, d)])) == 1   # first cross fires
    assert bb._evaluate([("AAA", 6_000_000, 40.0, d)]) == []       # same size → no re-alert
    assert bb._evaluate([("AAA", 5_000_000, 40.0, d)]) == []       # smaller → no re-alert
    assert len(bb._evaluate([("AAA", 9_000_000, 40.0, d)])) == 1   # strictly bigger → re-alert
    # new day, same ticker → fires again (dedup is per (date, ticker)).
    assert len(bb._evaluate([("AAA", 6_000_000, 40.0, "2026-08-15")])) == 1


def test_etf_gating_bond_out_heavy_index_in(temp_db, monkeypatch):
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_PCT_ADV", "5")
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_MIN_NOTIONAL", "4e6")
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_EQUITY_ONLY", "0")
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_ETF_MIN_NOTIONAL", "100e6")
    _patch_stats(monkeypatch, {"SPAB": 10_000_000, "VUG": 2_000_000,
                               "VOO": 5_000_000, "BIRK": 2_000_000})
    monkeypatch.setattr(bb, "_is_etf", lambda tk: tk.upper() in {"SPAB", "VUG", "VOO"})
    monkeypatch.setattr(bb, "_is_bond_etf", lambda tk: tk.upper() == "SPAB")
    d = "2026-08-14"
    prints = [
        ("SPAB", 200_000_000, 25.0, d),   # bond ETF → excluded even though heavy
        ("VUG",   57_000_000, 89.0, d),   # non-bond ETF < $100M → excluded
        ("VOO",  402_000_000, 713.0, d),  # non-bond ETF ≥ $100M → INCLUDED
        ("BIRK",  41_000_000, 39.0, d),   # equity → included
    ]
    assert {e["ticker"] for e in bb._evaluate(prints)} == {"VOO", "BIRK"}


def test_is_bond_etf_is_network_free():
    for b in ("SPAB", "USHY", "BNDX", "JPST", "MBB", "JAAA", "IGLB", "JMUB", "VTEB", "VCLT"):
        assert bb._is_bond_etf(b) is True, b
    for nb in ("VOO", "GLD", "SPY", "EFV", "VUG"):  # ETFs, but not bond
        assert bb._is_bond_etf(nb) is False, nb


def test_evaluate_max_pct_ceiling(temp_db, monkeypatch):
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_PCT_ADV", "5")
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_MIN_NOTIONAL", "4e6")
    monkeypatch.setenv("DARKPOOL_BIGBLOCK_MAX_PCT_ADV", "400")
    # Thin-ticker artifact: tiny avg vol → absurd %ADV, must be dropped.
    _patch_stats(monkeypatch, {"DYNC": 10_000, "REAL": 1_000_000})
    d = "2026-08-14"
    prints = [
        ("DYNC", 4_400_000, 34.0, d),   # 129k sh / 10k avg = 1294% → artifact, skip
        ("REAL", 6_000_000, 40.0, d),   # 150k sh / 1M avg = 15% → fires
    ]
    assert {e["ticker"] for e in bb._evaluate(prints)} == {"REAL"}


def test_is_etf_is_network_free():
    # Known dark-pool ETFs are caught by the static set with NO FMP call — the
    # resilience fix (FMP-only + fail-open let a wall of ETFs through once).
    for etf in ("SPYG", "VUG", "VTV", "JAAA", "MBB", "EFV", "SCZ", "USHY", "BNDX", "XLC"):
        assert bb._is_etf(etf) is True, etf
    # Real equities are not flagged (fall through to aggregator/FMP → False).
    for eq in ("ACN", "CRWD", "GE", "UAL"):
        assert bb._is_etf(eq) is False, eq


def test_disabled_short_circuits(monkeypatch):
    monkeypatch.delenv("DARKPOOL_BIGBLOCK_ENABLED", raising=False)
    assert bb.refresh_from_today() == {"ok": False, "reason": "disabled"}


# ── embed builder (pure, no I/O) ───────────────────────────────────────────
def _ev(ticker, notional, price, pct, is_etf=False):
    return {"ticker": ticker, "notional": notional, "price": price,
            "pct_adv": pct, "is_etf": is_etf}


def test_embed_ranks_tiers_and_splits_etfs():
    events = [
        _ev("VOO", 1.05e9, 700.65, 19, is_etf=True),
        _ev("IQMM", 320e6, 100.10, 174),
        _ev("BZ", 14.7e6, 15.78, 26),
        _ev("CMS", 48.3e6, 69.83, 19),
    ]
    embed = bb._build_embed(events, {}, "2026-08-20T19:12:00+00:00")
    d = embed["description"]
    # Headline counts single stocks only, ETF excluded, standout = top %ADV.
    assert "3 single-stock blocks" in d and "standout IQMM" in d
    # All three size-relative tiers present, in order.
    assert d.index("Exceptional") < d.index("Heavy") < d.index("Notable")
    # ETF is bucketed out of the single-stock tiers into its own section.
    assert "Broad ETF / index" in d
    assert d.index("IQMM") < d.index("Broad ETF")  # stocks before the ETF block
    assert embed["color"] == bb._GOLD


def test_embed_star_marks_record_prints_only():
    events = [_ev("IQMM", 320e6, 100.10, 174), _ev("BZ", 14.7e6, 15.78, 26)]
    # IQMM at/above its stored record → ★; BZ below its record → no ★.
    embed = bb._build_embed(events, {"IQMM": 300e6, "BZ": 50e6},
                            "2026-08-20T19:12:00+00:00")
    lines = embed["description"].splitlines()
    iqmm = next(l for l in lines if l.startswith("IQMM"))
    bz = next(l for l in lines if l.startswith("BZ"))
    assert iqmm.rstrip().endswith("★")
    assert not bz.rstrip().endswith("★")


def test_embed_caps_notable_and_reports_overflow():
    events = [_ev(f"T{i:02d}", 5e6, 40.0, 20 - (i % 10)) for i in range(20)]
    embed = bb._build_embed(events, {}, "2026-08-20T19:12:00+00:00")
    d = embed["description"]
    # Notable tier is capped; the remainder is disclosed, never silently dropped.
    assert f"more below" in d and "[open the dashboard" in d
    assert len(d) <= 4096


def test_embed_all_etf_headline_falls_back():
    events = [_ev("VOO", 1.05e9, 700.65, 19, is_etf=True),
              _ev("IVV", 1.05e9, 765.86, 19, is_etf=True)]
    d = bb._build_embed(events, {}, "2026-08-20T19:12:00+00:00")["description"]
    # No single stocks → headline speaks to the ETF blocks instead of "0 stocks".
    assert "single-stock" not in d
    assert "broad etf / index block" in d.lower()
