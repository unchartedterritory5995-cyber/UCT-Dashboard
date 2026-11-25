"""A `since=` answer served from a stale store, its repair still running, is never `current`.

Live session 2026-11-24 (production, 1m + 15m, S&P 500): the switch's own `since=` answer came back without the
bucket(s) that had just closed (RDDT: three minutes short; AMD, AMAT 3-5 s after a minute roll), and the client painted
it as the name not printing. The since path reads the store; when the store is stale it heals in the background
(BARS_SINCE_ASYNC_HEAL) or within a deadline, and serves the local delta NOW. The router then judged that tail with
the one-bucket tolerance and could call it `current`. Now:
  P1  the since path marks an answer served while the stale store's repair is pending (`tail_pending`): the async heal,
      the deadline, a failed repair; never when the store was fresh or the repair landed (P1b-d)
  P2  the router turns a pending tail the tolerance would call `current` into `unverified` (+ Retry-After), keeps a
      provider-`verified` one, and never forwards the marker itself (P2b, P2c)
"""
import json

import orjson
from fastapi.responses import JSONResponse

import api.services.bars_fetch as bf


def _wire(monkeypatch, *, stale=True):
    monkeypatch.setattr(bf, "_is_yf_only_symbol", lambda s: False)
    monkeypatch.setattr(bf, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bf, "_live_derive_on_read", lambda *a, **k: None)
    monkeypatch.setattr(bf._sqlite, "get_last_ts", lambda *a, **k: 1_700_000_000)
    monkeypatch.setattr(bf, "_needs_fresh", lambda *a, **k: stale)
    monkeypatch.setattr(bf._sqlite, "get_bars_since", lambda *a, **k: [(1_700_000_060, 1, 2, 0.5, 1.5, 100)])
    monkeypatch.setattr(bf._sqlite, "get_bars", lambda *a, **k: [])
    monkeypatch.setattr(bf, "_fmt_sqlite_bars",
                        lambda rows, tf, sym: [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                                               for r in rows])
    monkeypatch.setattr(bf.cache, "invalidate", lambda *a, **k: None)
    monkeypatch.setattr(bf, "_enqueue_since_bg_heal", lambda *a, **k: None)


def _body(resp):
    return json.loads(bytes(resp.body))


def test_P1_async_heal_marks_the_answer_pending(monkeypatch):
    _wire(monkeypatch)
    monkeypatch.setenv("BARS_SINCE_ASYNC_HEAL", "1")
    body = _body(bf._get_bars_since_response("RDDT", "1", 960, "1700000000"))
    assert body["delta"] is True
    assert body.get("tail_pending") is True


def test_P1_a_repair_past_its_deadline_marks_it_pending(monkeypatch):
    _wire(monkeypatch)
    monkeypatch.delenv("BARS_SINCE_ASYNC_HEAL", raising=False)
    monkeypatch.setattr(bf, "_bounded_delta", lambda *a, **k: False)
    body = _body(bf._get_bars_since_response("AMD", "1", 960, "1700000000"))
    assert body.get("tail_pending") is True


def test_P1b_a_repair_that_landed_is_not_pending(monkeypatch):
    _wire(monkeypatch)
    monkeypatch.delenv("BARS_SINCE_ASYNC_HEAL", raising=False)
    monkeypatch.setattr(bf, "_bounded_delta", lambda *a, **k: True)
    body = _body(bf._get_bars_since_response("AMD", "1", 960, "1700000000"))
    assert "tail_pending" not in body


def test_P1c_a_fresh_store_is_not_pending(monkeypatch):
    _wire(monkeypatch, stale=False)
    monkeypatch.setenv("BARS_SINCE_ASYNC_HEAL", "1")
    body = _body(bf._get_bars_since_response("AMD", "1", 960, "1700000000"))
    assert "tail_pending" not in body


def test_P1d_daily_is_never_marked(monkeypatch):
    _wire(monkeypatch)
    monkeypatch.setenv("BARS_SINCE_ASYNC_HEAL", "1")
    monkeypatch.setattr(bf, "_normalize_since_param", lambda s, d: "2026-11-20")
    body = _body(bf._get_bars_since_response("AMD", "D", 600, "2026-11-20"))
    assert "tail_pending" not in body


def _status(monkeypatch, verdict):
    from api.routers import bars as br
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda *a, **k: 1_700_000_000)
    monkeypatch.setattr(br._bars_fetch, "intraday_tail_status",
                        lambda *a, **k: {"tail_status": verdict, "verified_through": 1_699_999_990})
    return br


def test_P2_a_pending_tail_the_tolerance_calls_current_is_unverified(monkeypatch):
    br = _status(monkeypatch, "current")
    payload = {"ticker": "RDDT", "tf": "1", "bars": [{"t": 1_700_000_000}], "delta": True, "tail_pending": True}
    headers = br._apply_tail_status(payload, "RDDT", "1", "rth")
    assert payload["tail_status"] == "unverified"
    assert payload.get("retry_after") == 3 and headers.get("Retry-After") == "3"
    assert "tail_pending" not in payload


def test_P2_control_the_same_tail_not_pending_stays_current(monkeypatch):
    br = _status(monkeypatch, "current")
    payload = {"ticker": "RDDT", "tf": "1", "bars": [{"t": 1_700_000_000}], "delta": True}
    br._apply_tail_status(payload, "RDDT", "1", "rth")
    assert payload["tail_status"] == "current"


def test_P2b_a_provider_verified_tail_stays_verified(monkeypatch):
    br = _status(monkeypatch, "verified")
    payload = {"ticker": "RDDT", "tf": "1", "bars": [{"t": 1_700_000_000}], "delta": True, "tail_pending": True}
    br._apply_tail_status(payload, "RDDT", "1", "rth")
    assert payload["tail_status"] == "verified"


def test_P2c_the_marker_never_reaches_a_client(monkeypatch):
    from api.routers import bars as br
    body = {"ticker": "SPX", "tf": "1", "bars": [{"t": 1_700_000_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 0}],
            "delta": True, "tail_pending": True}
    out = br._augment_with_contract(JSONResponse(content=body), "SPX", "1", None, store_backed=False, tail_status=False)
    assert "tail_pending" not in orjson.loads(out.body)


# ── P3-P5: THE FULL PATH, THE HEAL'S PROOF, THE 1m MEMORY CACHE (2026-11-25) ─────────────────────────────────────────────
# Live market-open test 2026-11-25: the REST bars store trailed the live stream by 7-42 s at the open, and /api/bars
# called a tail one bucket short `current` with no proof the just-closed bucket printed nothing, so the client painted
# 1m charts one closed bar short. Now:
#   P3  EVERY answer (full, since=, to=): the one-bucket tolerance is `current` only when `verified_through` reaches the
#       end of the newest closed bucket; otherwise `unverified` + Retry-After. A tail AT the frontier needs no proof; a
#       provider-`verified` tail stays verified.
#   P4  `_heal_intraday_tail` stamps its proof at min(checked_at, now - publication lag): a heal one second after the
#       roll proves nothing about the bucket that just closed; a heal past the lag does, and the Retry-After retry heals.
#   P5  a 1m answer cached at :59 is never served after the minute rolls (memory TTL and max-age stop at the boundary).
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

_ET = ZoneInfo("America/New_York")


def _et(h, m, s=0):
    """Tuesday 2026-11-24 (a full trading day), ET."""
    return int(datetime(2026, 11, 24, h, m, s, tzinfo=_ET).timestamp())


ROLL = _et(10, 0)            # the 09:59 minute closes here: the newest closed 1m bucket is 09:59, its end is ROLL
FRONTIER = _et(9, 59)
ONE_SHORT = _et(9, 58)       # a thin name with no print in 09:59, or a store that has not landed it yet


@pytest.fixture
def clock(monkeypatch):
    now = {"t": float(ROLL + 1)}
    monkeypatch.setattr(time, "time", lambda: now["t"])
    return now


def _router():
    from api.routers import bars as br
    return br


def test_P3_a_full_answer_one_bucket_short_with_no_proof_is_unverified(clock):
    br = _router()
    payload = {"ticker": "THIN", "tf": "1", "bars": [{"t": ONE_SHORT}]}
    headers = br._apply_tail_status(payload, "THIN", "1", "rth", contract_vt=None)
    assert payload["tail_status"] == "unverified"
    assert payload.get("retry_after") == 3 and headers.get("Retry-After") == "3"


def test_P3_the_same_on_the_stores_own_proof(monkeypatch, clock):
    """No contract proof attached: the store's `tail_verified_through` is judged (here: none)."""
    br = _router()
    monkeypatch.setattr(bf, "tail_verified_through", lambda *a, **k: None)
    payload = {"ticker": "THIN", "tf": "1", "bars": [{"t": ONE_SHORT}]}
    headers = br._apply_tail_status(payload, "THIN", "1")
    assert payload["tail_status"] == "unverified" and headers.get("Retry-After") == "3"


def test_P3_a_proof_through_the_closed_bucket_makes_it_current(clock):
    br = _router()
    payload = {"ticker": "THIN", "tf": "1", "bars": [{"t": ONE_SHORT}]}
    headers = br._apply_tail_status(payload, "THIN", "1", "rth", contract_vt=ROLL)
    assert payload["tail_status"] in ("current", "verified")
    assert "Retry-After" not in headers and "retry_after" not in payload


def test_P3_a_proof_one_second_short_of_the_bucket_end_is_not_enough(clock):
    br = _router()
    payload = {"ticker": "THIN", "tf": "1", "bars": [{"t": ONE_SHORT}]}
    br._apply_tail_status(payload, "THIN", "1", "rth", contract_vt=ROLL - 1)
    assert payload["tail_status"] == "unverified"


def test_P3_control_a_tail_at_the_frontier_needs_no_proof(clock):
    br = _router()
    for tail in (FRONTIER, ROLL):        # the closed bucket printed / plus the forming row
        payload = {"ticker": "LIQ", "tf": "1", "bars": [{"t": tail}]}
        headers = br._apply_tail_status(payload, "LIQ", "1", "rth", contract_vt=None)
        assert payload["tail_status"] == "current" and "Retry-After" not in headers


def test_P3_control_a_provider_verified_tail_stays_verified(clock):
    br = _router()
    payload = {"ticker": "THIN", "tf": "1", "bars": [{"t": _et(9, 50)}]}
    br._apply_tail_status(payload, "THIN", "1", "rth", contract_vt=ROLL + 2)
    assert payload["tail_status"] == "verified"


def test_P3_a_since_delta_one_short_and_not_pending_is_unverified(monkeypatch, clock):
    """The rule is not the since path's alone: a delta whose store tail is one short, with no repair pending."""
    br = _router()
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda *a, **k: ONE_SHORT)
    monkeypatch.setattr(bf, "tail_verified_through", lambda *a, **k: None)
    payload = {"ticker": "THIN", "tf": "1", "bars": [], "delta": True}
    br._apply_tail_status(payload, "THIN", "1", "rth")
    assert payload["tail_status"] == "unverified"


def _heal_env(monkeypatch, clock, call_s):
    """A provider that answers ok with nothing new (a thin name) after `call_s` seconds."""
    stamped: list = []

    def _delta(t, tf, last_ts, status=None, tail_only=False):
        clock["t"] += call_s
        status["ok"] = True
        return []

    monkeypatch.setattr(bf, "_provider_write", lambda checked_at: bf._NullCheck())
    monkeypatch.setattr(bf, "_delta_intraday", _delta)
    monkeypatch.setattr(bf, "_mark_tail_verified", lambda t, tf, at: stamped.append(at))
    monkeypatch.setattr(bf, "tail_verified_through", lambda *a, **k: max(stamped) if stamped else None)
    return stamped


def _judge_thin():
    payload = {"ticker": "THIN", "tf": "1", "bars": [{"t": ONE_SHORT}]}
    headers = _router()._apply_tail_status(payload, "THIN", "1", "rth")
    return payload["tail_status"], headers


def test_P4_a_thin_name_after_its_heal_is_current(monkeypatch, clock):
    clock["t"] = ROLL + 5
    stamped = _heal_env(monkeypatch, clock, call_s=0.2)
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert stamped and stamped[0] >= ROLL
    status, headers = _judge_thin()
    assert status in ("current", "verified") and "Retry-After" not in headers


def test_P4_a_heal_one_second_after_the_roll_does_not_prove_the_closed_bucket(monkeypatch, clock):
    clock["t"] = ROLL + 1
    stamped = _heal_env(monkeypatch, clock, call_s=0.2)
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert stamped and stamped[0] < ROLL, "the proof must lag the provider's publication"
    status, headers = _judge_thin()
    assert status == "unverified" and headers.get("Retry-After") == "3"


def test_P4_the_retry_after_retry_heals_it(monkeypatch, clock):
    """The chart monitor's rule (`check_tail_status`): an `unverified` answer is honest only if it heals on the
    Retry-After retry. So the lag may not exceed the Retry-After."""
    clock["t"] = ROLL + 1
    _heal_env(monkeypatch, clock, call_s=0.1)
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert _judge_thin()[0] == "unverified"
    clock["t"] += 3                      # the client re-asks after Retry-After: 3
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert _judge_thin()[0] in ("current", "verified")


def _inner_env(monkeypatch, rows):
    from api.services import bars_live_store as bls
    monkeypatch.setattr(bf, "_is_yf_only_symbol", lambda s: False)
    monkeypatch.setattr(bf, "_record_intraday_request", lambda *a, **k: None)
    monkeypatch.setattr(bf, "_maybe_kick_deepfill", lambda *a, **k: None)
    monkeypatch.setattr(bf, "_live_derive_on_read", lambda *a, **k: None)
    monkeypatch.setattr(bf, "_live_derived_proof", lambda *a, **k: None)
    monkeypatch.setattr(bls, "covered", lambda *a, **k: False)
    monkeypatch.setattr(bf._sqlite, "get_last_ts", lambda *a, **k: rows[-1][0])
    monkeypatch.setattr(bf._sqlite, "get_bars", lambda *a, **k: list(rows))
    monkeypatch.setattr(bf, "_needs_fresh", lambda *a, **k: False)
    monkeypatch.setattr(bf, "_fmt_sqlite_bars",
                        lambda rs, tf, sym: [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                                             for r in rs])
    bf.cache.invalidate("bars_ZZCAPONE_1_1")


def _max_age(resp):
    cc = resp.headers.get("Cache-Control", "")
    return int(cc.split("max-age=")[1].split(",")[0])


def test_P5_a_1m_answer_cached_at_59_is_not_served_after_the_roll(monkeypatch, clock):
    rows = [(ONE_SHORT, 1, 2, 0.5, 1.5, 100)]
    _inner_env(monkeypatch, rows)
    try:
        clock["t"] = ROLL - 1                                  # 09:59:59
        first = bf._get_bars_inner("ZZCAPONE", "1", 1)
        assert _body(first)["bars"][-1]["t"] == ONE_SHORT
        assert _max_age(first) <= 1, "max-age must stop at the minute boundary"
        rows.append((FRONTIER, 1, 2, 0.5, 1.5, 100))           # the 09:59 bar lands
        clock["t"] = ROLL + 1                                  # 10:00:01
        second = bf._get_bars_inner("ZZCAPONE", "1", 1)
        assert _body(second)["bars"][-1]["t"] == FRONTIER, "served the answer cached before the roll"
    finally:
        bf.cache.invalidate("bars_ZZCAPONE_1_1")


def test_P5_a_memory_hit_inside_the_minute_never_advertises_past_the_boundary(monkeypatch, clock):
    rows = [(ONE_SHORT, 1, 2, 0.5, 1.5, 100)]
    _inner_env(monkeypatch, rows)
    try:
        clock["t"] = ROLL - 3                                  # 09:59:57: cached with ~3 s left
        bf._get_bars_inner("ZZCAPONE", "1", 1)
        clock["t"] = ROLL - 0.5                                # 09:59:59.5: still a memory hit
        hit = bf._get_bars_inner("ZZCAPONE", "1", 1)
        assert bf.get_serve_layer() == "mem"
        assert _max_age(hit) == 0
    finally:
        bf.cache.invalidate("bars_ZZCAPONE_1_1")


def test_P5_control_mid_minute_keeps_the_normal_ttl(monkeypatch, clock):
    rows = [(ONE_SHORT, 1, 2, 0.5, 1.5, 100)]
    _inner_env(monkeypatch, rows)
    try:
        clock["t"] = ROLL + 20                                 # 10:00:20: 40 s to the boundary
        assert _max_age(bf._get_bars_inner("ZZCAPONE", "1", 1)) == bf._CACHE_TTL["1"]
    finally:
        bf.cache.invalidate("bars_ZZCAPONE_1_1")
