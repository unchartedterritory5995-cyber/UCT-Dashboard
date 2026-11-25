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


#: The unverified Retry-After is jittered over 3-5 s (2026-11-25 review (c)).
RETRY_AFTERS = ("3", "4", "5")


def _retry_ok(payload, headers):
    return headers.get("Retry-After") in RETRY_AFTERS and str(payload.get("retry_after")) == headers["Retry-After"]


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
    assert _retry_ok(payload, headers)
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
    assert _retry_ok(payload, headers)


def test_P3_the_same_on_the_stores_own_proof(monkeypatch, clock):
    """No contract proof attached: the store's `tail_verified_through` is judged (here: none)."""
    br = _router()
    monkeypatch.setattr(bf, "tail_verified_through", lambda *a, **k: None)
    payload = {"ticker": "THIN", "tf": "1", "bars": [{"t": ONE_SHORT}]}
    headers = br._apply_tail_status(payload, "THIN", "1")
    assert payload["tail_status"] == "unverified" and _retry_ok(payload, headers)


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


def _heal_env(monkeypatch, clock, call_s, market=ROLL, rows=(), order=None, window_start=None):
    """A provider that answers ok after `call_s` seconds with `rows` (none: a thin name; a callable: called per ask).
    `market`: the market's publication watermark (`market_published_through`; a callable: called per read): by
    default the 09:59 minute is published market-wide. `window_start`: the rewritten window (enables the seal)."""
    stamped: list = []

    def _delta(t, tf, last_ts, status=None, tail_only=False):
        if order is not None:
            order.append("ask")
        clock["t"] += call_s
        status["ok"] = True
        if window_start is not None:
            status["window_start"] = window_start
        return [dict(r) for r in (rows() if callable(rows) else rows)]

    def _market(now=None):
        if order is not None:
            order.append("market")
        return market() if callable(market) else market

    monkeypatch.setattr(bf, "_provider_write", lambda checked_at: bf._NullCheck())
    monkeypatch.setattr(bf, "_delta_intraday", _delta)
    monkeypatch.setattr(bf, "_is_intraday_stale", lambda new: False)
    monkeypatch.setattr(bf._sqlite, "put_bars", lambda *a, **k: None)
    monkeypatch.setattr(bf, "market_published_through", _market, raising=False)
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
    assert status == "unverified" and headers.get("Retry-After") in RETRY_AFTERS


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
    monkeypatch.setattr(bf._sqlite, "is_old_grid_60m_ts", lambda *a, **k: False, raising=False)
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


# ── P6-P8: REVIEW #2732 (2026-11-25) ─────────────────────────────────────────────────────────────────────────────────
#   P6  the heal's proof is min(checked_at - lag, max(the newest bar THIS answer returned, the MARKET's publication
#       watermark)): "the provider answered ok" proves only "nothing newer that it has PUBLISHED". At the open the
#       provider publishes a closed minute 7-42 s late, so a heal at roll+5 s whose answer lacks the bucket proves
#       nothing until the market has published that minute. A thin name is proven once the market has (within the
#       lag); a liquid name proves itself with its own bar. The watermark is read BEFORE the heal asks.
#   P7  the unverified Retry-After is jittered over 3-5 s: no synchronized poll bursts at the open.
#   P8  the memory-cache cap holds on EVERY intraday tf, at its own bucket boundary (60m: every :00/:30).
def test_P6_a_heal_whose_answer_lacks_the_bucket_with_the_market_behind_is_unverified(monkeypatch, clock):
    clock["t"] = ROLL + 10                                     # well past the 3 s lag, provider not yet published
    stamped = _heal_env(monkeypatch, clock, call_s=0.2, market=FRONTIER)   # market published through 09:58 only
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert not stamped or max(stamped) < ROLL, "an unpublished minute was claimed empty"
    status, headers = _judge_thin()
    assert status == "unverified" and headers.get("Retry-After") in RETRY_AFTERS


def test_P6_the_market_past_the_bucket_makes_it_current(monkeypatch, clock):
    clock["t"] = ROLL + 10
    stamped = _heal_env(monkeypatch, clock, call_s=0.2, market=ROLL + 5)
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert stamped and max(stamped) >= ROLL
    assert _judge_thin()[0] in ("current", "verified")


def test_P6_a_thin_name_is_proven_within_the_publication_lag(monkeypatch, clock):
    clock["t"] = ROLL + bf_lag()                               # the first instant the lag allows
    stamped = _heal_env(monkeypatch, clock, call_s=0.1, market=ROLL)
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert stamped and max(stamped) >= ROLL
    assert _judge_thin()[0] in ("current", "verified")


def test_P6_a_liquid_name_proves_itself_with_its_own_bar(monkeypatch, clock):
    clock["t"] = ROLL + 10
    bar = {"t": FRONTIER, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}
    stamped = _heal_env(monkeypatch, clock, call_s=0.2, market=None, rows=[bar])   # no market watermark at all
    bf._heal_intraday_tail("LIQ", "1", ONE_SHORT)
    assert stamped == [ROLL], "proof = the end of the newest bar the answer returned"


def test_P6_no_returned_bar_and_no_market_watermark_proves_nothing(monkeypatch, clock):
    clock["t"] = ROLL + 10
    stamped = _heal_env(monkeypatch, clock, call_s=0.2, market=None)
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert not stamped or max(stamped) < ROLL


def test_P6_the_watermark_is_read_before_the_heal_asks(monkeypatch, clock):
    """A watermark read AFTER the ask could have advanced past a minute the answer did not yet hold."""
    order: list = []
    clock["t"] = ROLL + 10
    _heal_env(monkeypatch, clock, call_s=0.2, market=ROLL, order=order)
    bf._heal_intraday_tail("THIN", "1", ONE_SHORT)
    assert "market" in order and order.index("market") < order.index("ask"), order


def test_P6_the_live_streams_watermark_is_not_a_rest_publication_proof(monkeypatch, clock):
    """bars-api: the universe stream runs 7-42 s AHEAD of the REST store at the open. A stream watermark past the
    bucket says the STREAM delivered it, not that REST published it: an uncovered liquid name whose REST answer lacks
    the bucket would read `current` one bar short. Covered names keep their stream proof (`tail_verified_through`)."""
    from api.services import bars_live_store as bls
    monkeypatch.setitem(bls._state, "watermark_ms", FRONTIER * 1000)      # the stream delivered 09:59
    monkeypatch.setitem(bls._s1, "m1_watermark_ms", FRONTIER * 1000)
    monkeypatch.setattr(bls, "stream_alive", lambda: True)
    monkeypatch.setattr(bls, "m1_alive", lambda: True)
    monkeypatch.setattr(bf, "_fetch_market_reference_end", lambda: FRONTIER, raising=False)  # REST: through 09:58
    monkeypatch.setattr(bf, "_market_pub", {"through": None, "probed_at": None}, raising=False)
    clock["t"] = ROLL + 10
    stamped: list = []

    def _delta(t, tf, last_ts, status=None, tail_only=False):
        clock["t"] += 0.2
        status["ok"] = True
        return []

    monkeypatch.setattr(bf, "_provider_write", lambda checked_at: bf._NullCheck())
    monkeypatch.setattr(bf, "_delta_intraday", _delta)
    monkeypatch.setattr(bf, "_mark_tail_verified", lambda t, tf, at: stamped.append(at))
    bf._heal_intraday_tail("LIQ", "1", ONE_SHORT)
    assert not stamped or max(stamped) < ROLL


def bf_lag():
    return getattr(bf, "TAIL_PROOF_LAG_S", 3.0)


# the market publication watermark: ONE shared reference probe, cached to the minute
@pytest.fixture
def probe(monkeypatch):
    calls: list = []
    answers: list = []

    def _fetch():
        calls.append(time.time())
        a = answers.pop(0) if answers else None
        if isinstance(a, Exception):
            raise a
        return a

    monkeypatch.setattr(bf, "_fetch_market_reference_end", _fetch, raising=False)
    monkeypatch.setattr(bf, "_market_pub", {"through": None, "probed_at": None}, raising=False)
    return calls, answers


def test_P6_the_probe_is_one_call_per_minute_once_published(probe, clock):
    calls, answers = probe
    answers += [ROLL - 60, ROLL, ROLL + 60]          # 09:58 end (09:59 not yet out), then 09:59 out, then 10:00 out
    clock["t"] = ROLL + 2
    assert bf.market_published_through() == ROLL - 60
    clock["t"] = ROLL + 3                            # inside the re-probe floor: no call
    assert bf.market_published_through() == ROLL - 60
    clock["t"] = ROLL + 2 + bf._MARKET_PROBE_RETRY_S + 0.5
    assert bf.market_published_through() == ROLL
    for s in (20, 40, 59):                           # published through the frontier: no call for the minute
        clock["t"] = ROLL + s
        assert bf.market_published_through() == ROLL
    clock["t"] = ROLL + 61                           # the next minute closed: one call
    assert bf.market_published_through() == ROLL + 60
    assert len(calls) == 3


def test_P6_off_hours_one_probe_holds_until_the_next_session(probe, clock):
    calls, answers = probe
    fri_close = int(datetime(2026, 11, 20, 20, 0, tzinfo=_ET).timestamp())
    answers += [fri_close]
    for h in (10, 14, 22):
        clock["t"] = float(datetime(2026, 11, 21, h, 0, tzinfo=_ET).timestamp())    # Saturday
        assert bf.market_published_through() == fri_close
    assert len(calls) == 1


def test_P6_a_failed_probe_is_none_and_is_retried_after_the_floor(probe, clock):
    calls, answers = probe
    answers += [RuntimeError("429"), ROLL]
    clock["t"] = ROLL + 2
    assert bf.market_published_through() is None
    clock["t"] = ROLL + 3
    assert bf.market_published_through() is None and len(calls) == 1
    clock["t"] = ROLL + 2 + bf._MARKET_PROBE_RETRY_S + 0.5
    assert bf.market_published_through() == ROLL and len(calls) == 2


def test_P7_the_unverified_retry_after_is_jittered_over_3_to_5_s(clock):
    br = _router()
    seen = set()
    for _ in range(200):
        payload = {"ticker": "THIN", "tf": "1", "bars": [{"t": ONE_SHORT}]}
        headers = br._apply_tail_status(payload, "THIN", "1", "rth", contract_vt=None)
        assert _retry_ok(payload, headers)
        seen.add(headers["Retry-After"])
    assert len(seen) > 1, "every answer asked for the same retry instant"


@pytest.mark.parametrize("tf,length", [("5", 300), ("15", 900), ("30", 1800), ("60", 3600)])
def test_P8_every_intraday_tf_never_serves_a_copy_cached_before_its_roll(monkeypatch, clock, tf, length):
    roll = _et(10, 30)                               # a boundary of every tf's grid (60m RTH grid: 09:30 -> 10:30)
    before = roll - length                           # the bucket that closes at `roll`
    rows = [(before - length, 1, 2, 0.5, 1.5, 100)]
    _inner_env(monkeypatch, rows)
    key = f"bars_ZZCAPONE_{tf}_1"
    bf.cache.invalidate(key)
    try:
        clock["t"] = roll - 2
        first = bf._get_bars_inner("ZZCAPONE", tf, 1)
        assert _max_age(first) <= 2, "max-age must stop at the bucket boundary"
        rows.append((before, 1, 2, 0.5, 1.5, 100))  # the closing bucket lands
        clock["t"] = roll + 3                        # inside the old TTL, after the roll
        second = bf._get_bars_inner("ZZCAPONE", tf, 1)
        assert _body(second)["bars"][-1]["t"] == before, "served the answer cached before the roll"
    finally:
        bf.cache.invalidate(key)


def test_P8_60m_stops_at_every_half_hour_the_session_grids_roll_on(monkeypatch, clock):
    """The 60m TradingView RTH grid rolls at :30 (09:30, 10:30 ... and the 15:30 half bar ends 16:00), the ETH clock-hour
    grid at :00, the 09:00 pre-market stub at 09:30: a 60m copy never outlives the next :00 or :30."""
    rows = [(_et(9, 30), 1, 2, 0.5, 1.5, 100)]
    _inner_env(monkeypatch, rows)
    bf.cache.invalidate("bars_ZZCAPONE_60_1")
    try:
        clock["t"] = _et(15, 59, 58)
        assert _max_age(bf._get_bars_inner("ZZCAPONE", "60", 1)) <= 2
    finally:
        bf.cache.invalidate("bars_ZZCAPONE_60_1")


def test_P8_control_mid_bucket_keeps_the_normal_ttl(monkeypatch, clock):
    rows = [(_et(10, 0), 1, 2, 0.5, 1.5, 100)]
    _inner_env(monkeypatch, rows)
    bf.cache.invalidate("bars_ZZCAPONE_5_1")
    try:
        clock["t"] = _et(10, 2)                      # 3 minutes to the 5m boundary
        assert _max_age(bf._get_bars_inner("ZZCAPONE", "5", 1)) == bf._CACHE_TTL["5"]
    finally:
        bf.cache.invalidate("bars_ZZCAPONE_5_1")


# ── P9-P11: REVIEW #2732 ROUND 2 (2026-11-25) ────────────────────────────────────────────────────────────────────────
#   P9   the 45 s finality SEAL rests on the same publication proof: a bucket is final only once the market had
#        published it (seal_through = min(checked_at - SEAL_LAG_S, max(own newest bar end, market watermark))). A
#        sealed ABSENT bucket is proven empty and never re-read, so a seal over an unpublished minute is a permanent
#        hole on a worse open than the 42 s measured.
#   P10  the market watermark is the MAX over several references (SPY, QQQ, IWM): early pre-market minutes with no
#        SPY print must not keep thin names unverified. One probe round (one call per reference) per pod per minute.
#   P11  a probe that runs but whose watermark lags the frontier by > 2 min logs a rate-limited warning and is
#        counted on /api/stream/status (`bars_market_probe`): the "probe fails while heals succeed" amplification.
def _seal_env(monkeypatch):
    sealed: list = []
    monkeypatch.setattr(bf._sqlite, "record_sealed",
                        lambda t, tf, through, wstart, checked, covers_from=None: sealed.append(through))
    return sealed


def test_P9_a_lagging_open_never_seals_a_hole_a_later_rest_answer_fills(monkeypatch, clock):
    from api.services.bar_contract import SEAL_LAG_S
    sealed = _seal_env(monkeypatch)
    box = {"market": FRONTIER, "rows": []}
    _heal_env(monkeypatch, clock, call_s=0.2, market=lambda: box["market"], rows=lambda: box["rows"],
              window_start=_et(4, 0))
    clock["t"] = ROLL + SEAL_LAG_S + 5               # past the 45 s seal lag, REST still lagging (a worse open)
    bf._heal_intraday_tail("LIQ", "1", ONE_SHORT)
    assert sealed and max(sealed) < ROLL, "sealed the 09:59 bucket the provider had not published"
    # the later REST answer that holds it: now (and only now) it is final
    box.update(market=ROLL, rows=[{"t": FRONTIER, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}])
    clock["t"] += 10
    bf._heal_intraday_tail("LIQ", "1", ONE_SHORT)
    assert max(sealed) >= ROLL


def test_P9_control_a_published_bucket_seals_as_before(monkeypatch, clock):
    from api.services.bar_contract import SEAL_LAG_S
    sealed = _seal_env(monkeypatch)
    clock["t"] = ROLL + SEAL_LAG_S + 5
    _heal_env(monkeypatch, clock, call_s=0.2, market=ROLL + 40, window_start=_et(4, 0))
    checked = clock["t"]
    bf._heal_intraday_tail("LIQ", "1", ONE_SHORT)
    assert sealed == [checked - SEAL_LAG_S]


def test_P9_no_returned_bar_and_no_watermark_seals_nothing(monkeypatch, clock):
    from api.services.bar_contract import SEAL_LAG_S
    sealed = _seal_env(monkeypatch)
    clock["t"] = ROLL + SEAL_LAG_S + 5
    _heal_env(monkeypatch, clock, call_s=0.2, market=None, window_start=_et(4, 0))
    bf._heal_intraday_tail("LIQ", "1", ONE_SHORT)
    assert sealed == []


@pytest.fixture
def refs(monkeypatch):
    ends: dict = {}
    calls: list = []

    def _one(sym):
        calls.append(sym)
        v = ends.get(sym)
        if isinstance(v, Exception):
            raise v
        return v

    monkeypatch.setattr(bf, "_MARKET_REF_TICKERS", ("SPY", "QQQ", "IWM"), raising=False)
    monkeypatch.setattr(bf, "_fetch_reference_end", _one, raising=False)
    return ends, calls


def test_P10_the_watermark_is_the_max_over_the_references(refs):
    ends, calls = refs
    ends.update(SPY=_et(4, 2), QQQ=_et(4, 4), IWM=_et(4, 3))    # 04:03: no SPY print, QQQ printed
    assert bf._fetch_market_reference_end() == _et(4, 4)
    assert sorted(calls) == ["IWM", "QQQ", "SPY"], "one call per reference per round"


def test_P10_a_failing_reference_does_not_sink_the_round(refs):
    ends, _ = refs
    ends.update(SPY=RuntimeError("429"), QQQ=_et(4, 4), IWM=None)
    assert bf._fetch_market_reference_end() == _et(4, 4)


def test_P10_every_reference_failing_is_none(refs):
    ends, _ = refs
    ends.update(SPY=RuntimeError("429"), QQQ=None, IWM=RuntimeError("timeout"))
    assert bf._fetch_market_reference_end() is None


def test_P10_the_default_references_are_several():
    assert len(bf._MARKET_REF_TICKERS) >= 2 and "SPY" in bf._MARKET_REF_TICKERS


def _reset_probe_stats(monkeypatch):
    monkeypatch.setattr(bf, "_market_probe_stats",
                        {"probes": 0, "stale_probes": 0, "last_stale_log": None, "last_lag_s": None}, raising=False)


def test_P11_a_probe_that_runs_but_lags_the_frontier_warns_once_and_is_counted(probe, clock, monkeypatch, caplog):
    import logging
    calls, answers = probe
    _reset_probe_stats(monkeypatch)
    answers += [ROLL - 180] * 10                     # the watermark stuck 3 minutes behind the frontier
    with caplog.at_level(logging.WARNING, logger=bf.__name__):
        for k in range(3):
            clock["t"] = ROLL + 2 + k * (bf._MARKET_PROBE_RETRY_S + 0.5)
            bf.market_published_through()
    st = bf.market_probe_status()
    assert st["stale_probes"] == 3 and st["probes"] == 3
    assert st["last_lag_s"] >= 120
    warns = [r for r in caplog.records if "market probe stale" in r.getMessage()]
    assert len(warns) == 1, "rate-limited: one warning per window"


def test_P11_control_a_current_probe_never_warns(probe, clock, monkeypatch, caplog):
    import logging
    calls, answers = probe
    _reset_probe_stats(monkeypatch)
    answers += [ROLL - 60, ROLL]                     # one minute behind (the open), then current: not stale
    with caplog.at_level(logging.WARNING, logger=bf.__name__):
        clock["t"] = ROLL + 2
        bf.market_published_through()
        clock["t"] = ROLL + 2 + bf._MARKET_PROBE_RETRY_S + 0.5
        bf.market_published_through()
    assert bf.market_probe_status()["stale_probes"] == 0
    assert not [r for r in caplog.records if "market probe stale" in r.getMessage()]


def test_P11_the_counter_is_on_the_stream_status(monkeypatch, probe, clock):
    from api.routers import stream as stream_router
    _reset_probe_stats(monkeypatch)
    monkeypatch.setattr(stream_router, "get_stream_status", lambda: {})
    out = stream_router.stream_status()
    assert {"through", "probed_at", "probes", "stale_probes", "last_lag_s"} <= set(out["bars_market_probe"])
