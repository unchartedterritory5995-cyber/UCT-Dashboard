"""Subscribe-lag side recovery (2026-07-11).

Covers the two fixes for the NBIS-220C-style bug where a new contract's first
burst is classified blind (no NBBO yet), so an aggressive-buyer print gets
stored as a seller (tick-test inversion) or left empty:

  1. Fast-path subscribe (method tagging that drives eligibility)
  2. Post-NBBO reclassification (buffer -> re-pass -> in-place flow.db UPDATE)

The load-bearing correctness property is ZERO DRIFT: the dedup_key the worker
rebuilds for the re-pass UPDATE must byte-match the key insert_csv stored, or
the update silently hits nothing.
"""
import time
from collections import deque
from datetime import date

import pytest

from api import massive_ws_worker as mww
from api.massive_processor import AggEvent
from api.flow_db import FlowDB


def _evt(*, side="", side_method="", avg_price=8.50, premium=1_080_000,
         ts_ns=1_700_000_000_000_000_000, root="NBIS", strike=220.0, cp="CALL",
         total_size=127, type_="SWEEP", expiry=date(2026, 7, 17)):
    """An AggEvent modeled on the 7/10 NBIS 220C $1.08M sweep."""
    e = AggEvent(
        ticker="O:NBIS260717C00220000", root=root, cp=cp, strike=strike,
        expiry=expiry, avg_price=avg_price, total_size=total_size,
        premium=premium, first_ts_ns=ts_ns, last_ts_ns=ts_ns, n_exchanges=3,
        n_prints=3, type_=type_, side=side)
    e.side_method = side_method
    return e


@pytest.fixture(autouse=True)
def _clean_session_state():
    """Isolate the module-level session buffers between tests."""
    for d in (mww._RECLASSIFY_BUFFER, mww._NBBO_HISTORY, mww._RAW_T_HISTORY,
              mww._q_subscribed, mww._q_pending_subscribe):
        d.clear()
    yield
    for d in (mww._RECLASSIFY_BUFFER, mww._NBBO_HISTORY, mww._RAW_T_HISTORY,
              mww._q_subscribed, mww._q_pending_subscribe):
        d.clear()


@pytest.fixture
def db(tmp_path):
    return FlowDB(db_path=str(tmp_path / "flow.db"))


# ── _classify_side: the inversion the whole fix is about ──────────────

def test_classify_side_calls_the_aggressive_buyer_correctly():
    nbbo = (8.40, 8.45, 0)   # bid, ask, ts_ms
    # The $1.08M NBIS print filled at 8.50 -- above the ask => AA (super
    # aggressive buyer), NOT the "B" (seller) the tick test would invert it to.
    assert mww._classify_side(8.50, nbbo) == "AA"
    assert mww._classify_side(8.45, nbbo) == "A"
    assert mww._classify_side(8.40, nbbo) == "B"
    assert mww._classify_side(8.30, nbbo) == "BB"
    # No NBBO -> empty (this is the blind-burst condition that triggers the bug)
    assert mww._classify_side(8.50, None) == ""


# ── Zero-drift: the rebuilt dedup_key must match what insert_csv stored ─

def test_event_dedup_key_matches_the_stored_row(db):
    evt = _evt(side="B")
    csv = mww._events_to_csv([evt], "stocks")
    res = db.insert_csv(csv, source="stocks")
    assert res["inserted"] == 1

    key = mww._event_dedup_key(evt, "stocks")
    with db._conn() as conn:
        rows = conn.execute(
            "SELECT Side FROM flow WHERE dedup_key = ?", (key,)).fetchall()
    assert len(rows) == 1, "rebuilt dedup_key did not match the stored row"
    assert rows[0][0] == "B"


# ── update_sides_by_dedup: idempotent + never clobbers an NBBO side ────

def test_update_sides_idempotent_and_guarded(db):
    evt = _evt(side="B")
    db.insert_csv(mww._events_to_csv([evt], "stocks"), source="stocks")
    key = mww._event_dedup_key(evt, "stocks")

    # First recovery: stored "B" -> "AA"
    assert db.update_sides_by_dedup([(key, "AA", "B")]) == 1
    with db._conn() as conn:
        assert conn.execute("SELECT Side FROM flow WHERE dedup_key=?",
                            (key,)).fetchone()[0] == "AA"

    # Idempotent: re-running the same pass is a no-op (stored is now AA != B)
    assert db.update_sides_by_dedup([(key, "AA", "B")]) == 0

    # Never clobbers a side the guard doesn't match (an NBBO side is passed as
    # only_if_side="" say -> won't touch the "AA" we just wrote)
    assert db.update_sides_by_dedup([(key, "BB", "")]) == 0
    with db._conn() as conn:
        assert conn.execute("SELECT Side FROM flow WHERE dedup_key=?",
                            (key,)).fetchone()[0] == "AA"


# ── _classify_events_side: method tagging + buffer eligibility ─────────

def test_blind_print_is_tagged_none_and_buffered(monkeypatch):
    """No NBBO and no raw-T history => no side, and the print is buffered.

    ONDEMAND_QUOTE_ENABLED is forced OFF here so this keeps pinning the plain
    terminal tag. With it on (the default), a big SWEEP/BLOCK is instead
    diverted to the REST quote fetch — see the companion test below.
    """
    monkeypatch.setattr(mww, "ONDEMAND_QUOTE_ENABLED", False)
    evt = _evt()  # no NBBO history, no raw-T history => no signal at all
    mww._classify_events_side([evt])
    assert evt.side == ""
    assert evt.side_method == "none"
    assert len(mww._RECLASSIFY_BUFFER) == 1
    buffered = mww._RECLASSIFY_BUFFER[0]
    assert buffered["side"] == ""
    assert buffered["dedup_key"] == mww._event_dedup_key(evt, "stocks")


def test_blind_large_print_is_tagged_ondemand_pending(monkeypatch):
    """A large blind SWEEP/BLOCK is diverted to the on-demand quote fetch.

    The flusher keys off this transient tag to REST-fetch a quote instead of
    writing the print blank (the 77%-blank case); side stays "" until/unless
    that fetch succeeds.
    """
    monkeypatch.setattr(mww, "ONDEMAND_QUOTE_ENABLED", True)
    monkeypatch.setattr(mww, "ONDEMAND_QUOTE_PREMIUM", 100_000)
    evt = _evt(type_="SWEEP", premium=1_080_000)
    mww._classify_events_side([evt])
    assert evt.side == ""
    assert evt.side_method == "ondemand-pending"


def test_nbbo_classified_print_is_not_buffered():
    evt = _evt(avg_price=8.50)
    sym = mww._reconstruct_occ_symbol(evt.root, evt.expiry, evt.cp, evt.strike)
    # A fresh quote in force just before the trade: bid 8.40 / ask 8.45.
    mww._NBBO_HISTORY[sym] = deque([(evt.first_ts_ns - 1_000_000, 8.40, 8.45)])
    mww._classify_events_side([evt])
    assert evt.side == "AA"
    assert evt.side_method == "nbbo"
    assert len(mww._RECLASSIFY_BUFFER) == 0, "NBBO-classified print must not buffer"


# ── End-to-end: a blind-stored 'B' is recovered to 'AA' in flow.db ────

def test_end_to_end_recovers_inverted_side(db):
    # 1. Blind first burst: tick test inverted the AA buyer to a 'B' seller.
    evt = _evt(side="B", side_method="tick")
    db.insert_csv(mww._events_to_csv([evt], "stocks"), source="stocks")
    key = mww._event_dedup_key(evt, "stocks")

    # 2. Buffer it for the re-pass (as _classify_events_side would).
    mww._buffer_prints_for_reclassify([evt])
    assert len(mww._RECLASSIFY_BUFFER) == 1

    # 3. NBBO fills in a beat later (fast-path subscribe made it flow).
    sym = mww._reconstruct_occ_symbol(evt.root, evt.expiry, evt.cp, evt.strike)
    mww._NBBO_HISTORY[sym] = deque([(evt.first_ts_ns - 1_000_000, 8.40, 8.45)])

    # 4. Re-pass computes the recovery, buffer drained.
    updates = mww._collect_reclassifications(time.time())
    assert updates == [(key, "AA", "B")]
    assert len(mww._RECLASSIFY_BUFFER) == 0

    # 5. Apply -> the persisted (poll-served) row flips B -> AA.
    assert db.update_sides_by_dedup(updates) == 1
    with db._conn() as conn:
        assert conn.execute("SELECT Side FROM flow WHERE dedup_key=?",
                            (key,)).fetchone()[0] == "AA"


def test_repass_keeps_print_until_nbbo_arrives():
    evt = _evt(side="B", side_method="tick")
    mww._buffer_prints_for_reclassify([evt])
    # No NBBO history yet -> nothing recovered, entry retained for a later pass.
    assert mww._collect_reclassifications(time.time()) == []
    assert len(mww._RECLASSIFY_BUFFER) == 1


def test_repass_expires_prints_past_ttl():
    evt = _evt(side="B", side_method="tick")
    mww._buffer_prints_for_reclassify([evt])
    # Age the entry past the TTL; NBBO never arrived -> dropped, row left as-is.
    old = time.time() + mww._RECLASSIFY_TTL_SEC + 1
    assert mww._collect_reclassifications(old) == []
    assert len(mww._RECLASSIFY_BUFFER) == 0


def test_buffer_is_bounded(monkeypatch):
    monkeypatch.setattr(mww, "_RECLASSIFY_BUFFER_MAX", 3)
    # Distinct contracts so each produces its own dedup_key/entry.
    evts = [_evt(side_method="none", strike=100.0 + i) for i in range(6)]
    mww._buffer_prints_for_reclassify(evts)
    assert len(mww._RECLASSIFY_BUFFER) == 3, "buffer must drop oldest past the cap"
