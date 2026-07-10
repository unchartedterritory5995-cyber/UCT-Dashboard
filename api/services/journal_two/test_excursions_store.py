"""j2_trade_excursions side table + store — upsert/get/list/existing_refs.

Uses the `:memory:` + `ensure_schema(conn)` fixture pattern (mirrors
test_trade_refs.py); the store's `conn` param keeps every test off the real
auth.db. Excursions key on the STABLE trade_ref (`ext:<external_id>` broker /
`id:<row id>` manual), never raw external_id.
"""
import sqlite3

from api.services.journal_two import db as j2db
from api.services.journal_two.excursions_store import (
    upsert_excursion, get_excursion, list_excursions_for_user, existing_refs,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


_FULL = {
    "symbol": "NVDA",
    "mfe_price": 115.0,
    "mae_price": 96.0,
    "mfe_r": 3.0,
    "mae_r": -0.8,
    "mfe_ts": 2000,
    "mae_ts": 3000,
    "exit_efficiency": 0.6667,
    "missed_r": 1.0,
    "bar_resolution": "5m",
    "data_quality": "intraday_5m",
}


def test_upsert_get_roundtrip_camelcase():
    conn = _conn()
    upsert_excursion("u1", "id:t1", _FULL, conn)
    out = get_excursion("u1", "id:t1", conn)
    assert out is not None
    assert out["symbol"] == "NVDA"
    assert out["mfePrice"] == 115.0
    assert out["maePrice"] == 96.0
    assert out["mfeR"] == 3.0
    assert out["maeR"] == -0.8
    assert out["mfeTs"] == 2000
    assert out["maeTs"] == 3000
    assert out["exitEfficiency"] == 0.6667
    assert out["missedR"] == 1.0
    assert out["barResolution"] == "5m"
    assert out["dataQuality"] == "intraday_5m"
    assert out["computedAt"]  # stamped ISO timestamp


def test_get_missing_returns_none():
    conn = _conn()
    assert get_excursion("u1", "id:nope", conn) is None


def test_upsert_twice_replaces_single_row():
    conn = _conn()
    upsert_excursion("u1", "id:t1", _FULL, conn)
    updated = dict(_FULL, mfe_r=4.5, data_quality="intraday_1m")
    upsert_excursion("u1", "id:t1", updated, conn)
    n = conn.execute(
        "SELECT COUNT(*) FROM j2_trade_excursions WHERE user_id='u1' AND trade_ref='id:t1'"
    ).fetchone()[0]
    assert n == 1
    out = get_excursion("u1", "id:t1", conn)
    assert out["mfeR"] == 4.5
    assert out["dataQuality"] == "intraday_1m"


def test_list_excursions_for_user_ref_keyed_map():
    conn = _conn()
    upsert_excursion("u1", "id:t1", _FULL, conn)
    upsert_excursion("u1", "ext:bk:abc", dict(_FULL, symbol="TSLA"), conn)
    upsert_excursion("u2", "id:other", _FULL, conn)  # different user, excluded
    m = list_excursions_for_user("u1", conn)
    assert set(m.keys()) == {"id:t1", "ext:bk:abc"}
    assert m["id:t1"]["symbol"] == "NVDA"
    assert m["ext:bk:abc"]["symbol"] == "TSLA"
    assert m["id:t1"]["mfeR"] == 3.0


def test_existing_refs_returns_set():
    conn = _conn()
    upsert_excursion("u1", "id:t1", _FULL, conn)
    upsert_excursion("u1", "ext:bk:abc", _FULL, conn)
    upsert_excursion("u2", "id:other", _FULL, conn)
    refs = existing_refs("u1", conn)
    assert refs == {"id:t1", "ext:bk:abc"}
    assert isinstance(refs, set)


def test_insufficient_tier_row_stores_none_metrics():
    conn = _conn()
    insufficient = {
        "symbol": "XYZ",
        "mfe_price": None,
        "mae_price": None,
        "mfe_r": None,
        "mae_r": None,
        "mfe_ts": None,
        "mae_ts": None,
        "exit_efficiency": None,
        "missed_r": None,
        "bar_resolution": None,
        "data_quality": "insufficient",
    }
    upsert_excursion("u1", "id:thin", insufficient, conn)
    out = get_excursion("u1", "id:thin", conn)
    assert out is not None
    assert out["dataQuality"] == "insufficient"
    assert out["symbol"] == "XYZ"
    assert out["mfePrice"] is None
    assert out["maeR"] is None
    assert out["exitEfficiency"] is None
    assert out["computedAt"]  # still stamped even for an insufficient record
