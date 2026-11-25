"""A week or month answer served from the stale store says so (the wide sweep W2, production 2026-11-25).

The month chart painted the current month's bar with an OLD close (TXN 295.86 against 265.02) on 23 of 30 presses; every
one of those copies was a warm's answer the server had served stale-while-revalidate (`bars(stale-swr)`), and the 7 that
painted right had a `bars(mem)` answer. The router now states it on every live-equity W/M answer:
  S1  a stale serve: `tail_status: "unverified"`, `retry_after` and the Retry-After header
  S2  any other serve: `tail_status: "current"` (a later answer always replaces the word on the client)
  S3  not judged (`date_stale=None`: D, intraday, replay, a non-equity series): nothing added
  S4  the route passes the serve layer for W/M only
"""
import json

from fastapi.responses import JSONResponse

import api.routers.bars as br

ROWS = [{"t": "2026-11-01", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}]


def _resp(tf="M"):
    return JSONResponse(content={"ticker": "TXN", "tf": tf, "bars": list(ROWS)})


def _call(tf="M", date_stale=None, tail_status=True):
    out = br._augment_with_contract(_resp(tf), "TXN", tf, None, store_backed=False, tail_status=tail_status,
                                    date_stale=date_stale)
    return json.loads(bytes(out.body)), out.headers


def test_S1_a_stale_week_or_month_serve_is_unverified():
    for tf in ("W", "M"):
        body, headers = _call(tf, date_stale=True)
        assert body["tail_status"] == "unverified"
        assert body["retry_after"] == br._DATE_STALE_RETRY_AFTER_S
        assert headers.get("Retry-After") == str(br._DATE_STALE_RETRY_AFTER_S)
        assert body["bars"] == ROWS                          # the rows are untouched


def test_S2_any_other_serve_says_current():
    for tf in ("W", "M"):
        body, headers = _call(tf, date_stale=False)
        assert body["tail_status"] == "current"
        assert "retry_after" not in body and "Retry-After" not in headers


def test_S3_not_judged_adds_nothing():
    body, _ = _call("M", date_stale=None)
    assert "tail_status" not in body
    body, _ = _call("D", date_stale=True)                    # D keeps its own paint rule
    assert "tail_status" not in body
    body, _ = _call("M", date_stale=True, tail_status=False)  # replay / not live equity
    assert "tail_status" not in body


def test_S4_the_route_passes_the_serve_layer_for_week_and_month_only():
    import inspect
    src = inspect.getsource(br)
    assert 'date_stale=((get_serve_layer() == "stale-swr") if tf in _WEEK_MONTH_TFS else None)' in src
    assert br._WEEK_MONTH_TFS == ("W", "M")
