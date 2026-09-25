"""`/flow TICKER` — a single-ticker lookup must not cap-scale its floors (2026-09-24).

⚰️ THE INCIDENT. Three members ran `/flow BP`, `/flow ASTS`, `/flow DELL` during the
2026-09-24 session and every one read "no significant options flow today". DELL's tape that
day held 1,161 prints and $120M of premium, 27 of them MAGENTA/YELLOW, one contract at $3.69M.
The card printed nothing because `_compute_ticker_flow` reuses the MARKET-WIDE By-Contract
rollup, whose floors are cap-scaled to pick a handful of names out of the whole market: a mega
cap needs ONE contract to total $1M in ONE day (`_rollup_total_floor`) and every print to clear
$250K (`_rollup_floor`). DELL's only two $1M+ contracts were block-only (excluded by the owner's
2026-09-07 ruling) and its twenty-odd sweeps each fell under $1M, so a $9M day rendered as a
quiet one. Measured in the flow-worker pod on the real tape: baseline 0 contracts, with the
single-ticker floors 16 contracts and a $2.58M-vs-$114K bull net.

The docstring on `_compute_ticker_flow` already promised "Uncapped per ticker" — a claim nobody
had wired (`lesson_a_comment_claiming_agreement_is_not_agreement`). These tests wire it.

The print classifier (`_row_to_alert`) is stubbed: it has its own dozen drop rules, none of
which this change touches, and the pod measurement above already covered the real one.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import sys
import types

import pytest

from api import live_massive_router as lmr
from api.flow_db import FlowDB

MEGA_CAP = 271_369_000_000        # DELL on 2026-09-24 — above `large_max` (200B) → "mega" band
TICKER = "DELLX"                  # not a real name: keeps the module-level 60 s card cache out of it


def _fake_row_to_alert(row, require_direction=True, agg_ask_premium=0.0, agg_ask_volume=0.0):
    """The rollup's view of a print, minus the classifier's own drop rules."""
    return {
        "ticker": row["Symbol"], "cp": "C" if row["CallPut"] == "CALL" else "P",
        "strike": float(row["Strike"]), "exp": row["ExpirationDate"], "source": row["source"],
        "_mktCap": int(row["MktCap"]), "spot": float(row["Spot"]), "dte": int(row["Dte"]),
        "moneynessPct": 1.0, "moneynessLabel": "OTM",
        "alertPremium": float(row["Premium"]), "tradeSize": int(row["Volume"]),
        "_tierKey": "bullish", "_direction": "Bull", "_side": row["Side"], "_type": row["Type"],
        "grade": "C", "priorOI": int(row["OI"]), "timestamp": int(row["id"]) * 60,
        "averageFillPrice": float(row["Price"]),
        "aggAskPremium": agg_ask_premium, "aggAskVolume": agg_ask_volume,
    }


@pytest.fixture
def tape(tmp_path, monkeypatch):
    """A flow.db holding ONE sweep-backed mega-cap contract: three $150K prints, $450K total.
    Under the mega band that is below BOTH floors ($250K/print, $1M/contract); under the
    most-permissive band ($15K/print, $100K/contract) it clears both."""
    db = tmp_path / "flow.db"
    FlowDB(str(db))
    today = lmr._today_mdyyyy()
    exp = dt.datetime.now(lmr.ET).date() + dt.timedelta(days=30)
    exp_s = f"{exp.month}/{exp.day}/{exp.year}"
    conn = sqlite3.connect(str(db))
    for i in range(3):
        conn.execute(
            "INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Type, Volume, Price, Side, "
            "CallPut, Strike, Spot, Premium, ExpirationDate, Color, Dte, MktCap, OI, dedup_key) "
            "VALUES ('stocks', ?, ?, ?, 'SWEEP', '100', '15.0', 'A', 'CALL', '535', '530', "
            "'150000', ?, 'YELLOW', '30', ?, '100', ?)",
            (today, f"10:0{i}:00", TICKER, exp_s, str(MEGA_CAP), f"k{i}"))
    conn.commit()
    conn.close()
    monkeypatch.setattr(lmr, "DB_PATH", str(db))
    monkeypatch.setattr(lmr, "_THRESHOLDS_PATH", str(tmp_path / "no-such-thresholds.json"))
    monkeypatch.setattr(lmr, "_thresholds_cache", None)          # defaults, not the box's file
    monkeypatch.setattr(lmr, "_has_dormant_data", lambda: False)
    monkeypatch.setattr(lmr, "_row_to_alert", _fake_row_to_alert)
    monkeypatch.delenv("FLOW_EXCLUDE_BLOCK_ONLY", raising=False)
    # The card's live enrichment (Massive per-contract snapshots, the OI history store) is
    # decoration and reaches the network / a data dir; stub both modules out of the process.
    moi = types.SimpleNamespace(fetch_price_oi_for_contracts=lambda sym, top: {},
                                _canon_mdy=lambda s: str(s or "").strip())
    ois = types.SimpleNamespace(make_key=lambda *a: a, get_history=lambda k, n: [])
    monkeypatch.setitem(sys.modules, "api.massive_oi_snapshots", moi)
    monkeypatch.setitem(sys.modules, "api.oi_snapshots", ois)
    lmr._ticker_flow_cache.clear()
    return today


def test_single_ticker_lookup_keeps_a_mega_cap_contract_under_the_market_wide_floor(tape):
    p = lmr._build_by_contract(tape, "stocks", 1, True, 1, only_ticker=TICKER)
    got = [(c["cp"], c["strike"], c["total_premium"]) for c in p["contracts"]]
    assert got == [("C", 535.0, 450_000)], (
        f"a $450K sweep-backed contract on a mega cap vanished from its own ticker's card: {got}")


def test_market_wide_rollup_still_cap_scales_its_floors(tape):
    """THE CONTROL. The change is scoped to `only_ticker`; the market-wide feed still asks a
    mega cap to total $1M. Without this half a fix that relaxed EVERY floor would pass the
    test above and flood the By-Contract feed with $100K mega-cap churn."""
    p = lmr._build_by_contract(tape, "stocks", 1, True, 1)
    assert p["contracts"] == [], f"the market-wide floor no longer applies: {p['contracts']}"


def test_the_flow_card_itself_shows_the_contract(tape):
    """End to end through `_compute_ticker_flow` — the function the Discord job calls — so the
    block-only and expiry filters that sit AFTER the rollup are exercised too."""
    d = lmr._compute_ticker_flow(TICKER, "1", "stocks", 15)
    assert d["ok"] and d["contract_count"] == 1, d
    assert d["contracts"][0]["premium"] == 450_000
    assert d["net"]["dir"] == "BULL"
    assert d["window"]["active_days"] == 1
