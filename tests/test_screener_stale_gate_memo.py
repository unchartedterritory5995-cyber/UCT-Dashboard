"""The stale-row gate is computed once per snapshot, not once per request.

`query.stale_gate` walks `bars_asof` across the whole table (a full-table read).
Every /scan and every /count paid it, for an answer that can only change when
the nightly table is rewritten. It is now kept against the snapshot's own
fingerprint, the same stamp the live sweeper and the count cache trust.

Results must not move: a warm memo and a cold one return the identical answer.
Every fixture is a tmp database; nothing reads C:\\data.
"""
import pytest

FRESH, DEAD = "20261014", "20260901"


def _row(ticker, bars_asof, **kw):
    r = {"ticker": ticker, "price": 50.0, "rsi14": 60.0, "uct_composite": 70,
         "snapshot_date": "2026-10-15", "bars_asof": bars_asof}
    r.update(kw)
    return r


@pytest.fixture
def seeded(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.delenv("SCREENER_STALE_PRICE_SESSIONS", raising=False)
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    from api.services.screener import query, snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows([_row("AAA", FRESH), _row("DED", DEAD)])
    monkeypatch.setattr(query, "_STALE_GATE_MEMO", None)
    return snapshot_db


@pytest.fixture
def computed(monkeypatch):
    """How many times the full-table read actually ran."""
    from api.services.screener import snapshot_builder
    real = snapshot_builder.stale_row_gate
    calls = []

    def counting(conn, table="screener_rows"):
        calls.append(table)
        return real(conn, table=table)

    monkeypatch.setattr(snapshot_builder, "stale_row_gate", counting)
    return calls


def _gate(snapshot_db):
    from api.services.screener import query
    with snapshot_db.connect() as conn:
        return query.stale_gate(conn)


def test_the_full_table_read_runs_once_for_one_snapshot(seeded, computed):
    first = _gate(seeded)
    second = _gate(seeded)
    assert first is not None
    assert second == first
    assert len(computed) == 1


def test_a_gate_answering_none_is_kept_too(monkeypatch, tmp_path, computed):
    """Most nights no row is behind; that answer is the commonest one to keep."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "n.db"))
    monkeypatch.delenv("SCREENER_STALE_PRICE_SESSIONS", raising=False)
    from api.services.screener import query, snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows([_row("AAA", FRESH)])
    monkeypatch.setattr(query, "_STALE_GATE_MEMO", None)
    assert _gate(snapshot_db) is None
    assert _gate(snapshot_db) is None
    assert len(computed) == 1


def test_a_rewrite_of_the_table_is_seen_on_the_next_request(seeded, computed):
    assert _gate(seeded) is not None
    seeded.upsert_rows([_row("DED", FRESH)])          # the name's bars caught up
    assert _gate(seeded) is None
    assert len(computed) == 2


def test_the_builders_threshold_still_decides(seeded, computed, monkeypatch):
    """`SCREENER_STALE_PRICE_SESSIONS` is the builder's knob and part of the key."""
    assert _gate(seeded) is not None
    monkeypatch.setenv("SCREENER_STALE_PRICE_SESSIONS", "60")
    assert _gate(seeded) is None
    assert len(computed) == 2


def test_a_caller_editing_its_gate_cannot_reach_the_kept_one(seeded):
    first = _gate(seeded)
    first["params"].append("garbage")
    first["sql"] = "garbage"
    second = _gate(seeded)
    assert second["sql"] != "garbage"
    assert "garbage" not in second["params"]


def test_an_unreadable_fingerprint_only_turns_the_memo_off(seeded, computed, monkeypatch):
    from api.services.screener import live_tier

    def broken(conn):
        raise RuntimeError("no fingerprint")

    monkeypatch.setattr(live_tier, "_anchor_fingerprint", broken)
    first = _gate(seeded)
    assert first is not None
    assert _gate(seeded) == first
    assert len(computed) == 2


def test_the_scan_answers_identically_with_a_warm_and_a_cold_memo(seeded, monkeypatch):
    from api.services.screener import query
    spec = {"filters": [{"key": "price", "op": "gte", "min": 5}], "page_size": 50}
    cold = query.run_scan(spec)
    assert cold["total"] == 1
    assert cold["snapshot"]["stale"]["excluded"] == 1
    warm = query.run_scan(spec)
    monkeypatch.setattr(query, "_STALE_GATE_MEMO", None)
    cold_again = query.run_scan(spec)
    assert warm == cold
    assert cold_again == cold
    assert query.preview_count(spec)["count"] == cold["total"]
