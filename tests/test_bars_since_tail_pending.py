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
