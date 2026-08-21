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
    backfill_true_r,
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
    "true_r": 2.5,
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
    assert out["trueR"] == 2.5
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


# ── backfill_true_r — pure-SQL heal for pre-column rows ──────────────────

def _seed_trade(conn, tid, *, side="Long", entry=100.0, exit_p=110.0,
                external_id=None, user_id="u1"):
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at, external_id
        ) VALUES (?, ?, 'manual', 'NVDA', ?, 100, ?, '2026-08-01', ?,
                  '2026-08-05', ?, NULL, NULL, 0, 0, NULL, 4, 'Win', '{}',
                  1, '2026-08-05T00:00:00', ?)
        """,
        (tid, user_id, side, entry, exit_p, entry, external_id),
    )
    conn.commit()


def _seed_legacy_excursion(conn, trade_ref, *, mae_price, user_id="u1"):
    """A row written BEFORE the true_r column existed (true_r NULL)."""
    row = dict(_FULL, mae_price=mae_price)
    row.pop("true_r")
    upsert_excursion(user_id, trade_ref, row, conn)
    conn.execute(
        "UPDATE j2_trade_excursions SET true_r = NULL WHERE trade_ref = ?",
        (trade_ref,),
    )
    conn.commit()


def test_backfill_true_r_long_via_id_ref():
    conn = _conn()
    _seed_trade(conn, "t1", entry=100.0, exit_p=110.0)
    _seed_legacy_excursion(conn, "id:t1", mae_price=96.0)
    n = backfill_true_r(conn)
    assert n == 1
    out = get_excursion("u1", "id:t1", conn)
    assert out["trueR"] == (110.0 - 100.0) / (100.0 - 96.0)  # 2.5


def test_backfill_true_r_short_via_ext_ref():
    conn = _conn()
    _seed_trade(conn, "t2", side="Short", entry=50.0, exit_p=45.0,
                external_id="snap-abc")
    _seed_legacy_excursion(conn, "ext:snap-abc", mae_price=53.0)
    backfill_true_r(conn)
    out = get_excursion("u1", "ext:snap-abc", conn)
    assert abs(out["trueR"] - (50.0 - 45.0) / (53.0 - 50.0)) < 1e-9


def test_backfill_skips_already_computed_and_is_idempotent():
    conn = _conn()
    _seed_trade(conn, "t1", entry=100.0, exit_p=110.0)
    upsert_excursion("u1", "id:t1", _FULL, conn)  # already carries true_r=2.5
    assert backfill_true_r(conn) == 0
    assert get_excursion("u1", "id:t1", conn)["trueR"] == 2.5


def test_backfill_no_adverse_or_orphan_stays_null():
    conn = _conn()
    # MAE at entry ⇒ zero adverse ⇒ NULL by design (never inf)
    _seed_trade(conn, "t1", entry=100.0, exit_p=110.0)
    _seed_legacy_excursion(conn, "id:t1", mae_price=100.0)
    # orphan excursion (no matching trade — e.g. option-strategy underlying)
    _seed_legacy_excursion(conn, "id:ghost", mae_price=96.0)
    backfill_true_r(conn)
    assert get_excursion("u1", "id:t1", conn)["trueR"] is None
    assert get_excursion("u1", "id:ghost", conn)["trueR"] is None


def test_backfill_never_crosses_users():
    conn = _conn()
    _seed_trade(conn, "t1", entry=100.0, exit_p=110.0, user_id="u1")
    # u2 owns the excursion but NOT the trade — must stay NULL
    _seed_legacy_excursion(conn, "id:t1", mae_price=96.0, user_id="u2")
    backfill_true_r(conn)
    assert get_excursion("u2", "id:t1", conn)["trueR"] is None
