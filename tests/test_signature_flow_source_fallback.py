"""H1: the flow DB files index/ETF symbols under a DIFFERENT source.

`/api/flow/ticker/{sym}` takes `?source=` and defaults to `stocks`
(`flow_router.get_flow_ticker`: `src = "indexes" if source == "indexes" else
"stocks"`). SPY, QQQ, IWM and every XL* — ~200 names, and the ones a user is
most likely to chart — live under `indexes`. Both Signature flow readers asked
for the default and got a header with no rows back, so the join was empty, the
breakout was never confirmed, and the indicator was silently dead on exactly the
symbols the nightly sweep leads with.

The fix is a fallback, not a symbol list: ask `stocks`, and if the PARSE yields
zero rows, ask `indexes` once. No hardcoded membership to drift out of date, and
the common case (a real stock) still costs exactly one request — which is what
the counter on the server below is for.

A read FAILURE is not zero rows. A 500 from the flow service must not be
retried as if it were a quiet tape and must not be reported as one
(`lesson_market_cap_cache_poison`), so the failure tests here pin that the
second source is never even asked.

The server is real (gzipped CSV over HTTP, keyed off `flow_db.COLUMNS`), not an
injected stub: the whole behaviour under test is a query parameter on a wire
request, and a stub proves nothing about what actually got sent
(`lesson_injected_dependency_hides_the_fetch`).
"""
import gzip
import threading
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.flow_db import COLUMNS
from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import signature as sig
from api.services.signature import ledger
from api.services.signature import sweep as sweep_mod


def _csv_row(**kv) -> str:
    """One row in the REAL column order the surface emits."""
    return ",".join(str(kv.get(c, "")) for c in COLUMNS)


_HEADER = ",".join(COLUMNS)


@pytest.fixture
def flow_source_server(monkeypatch):
    """A real flow surface that FILTERS by `?source=`, and counts what it saw.

    Mirrors `flow_db.stream_csv_symbol`: it always emits the header, then only
    the rows matching (source, symbol) — so "no rows for this source" arrives as
    a perfectly valid 200 with a header and nothing else, exactly as production
    does. That shape is the entire bug: it is indistinguishable from a quiet
    tape unless you ask the other source.
    """
    state = {"rows": {}, "status": 200}
    seen = []

    class _H(BaseHTTPRequestHandler):
        # HTTP/1.0 + an explicit `Connection: close`, NOT HTTP/1.1 keep-alive.
        # These tests are the only ones here that make TWO sequential requests
        # (the stocks miss, then the indexes retry), which is exactly what a
        # keep-alive connection is stateful across. With 1.1 the server thread
        # sits in its keep-alive loop after responding and the client closes
        # underneath it, so teardown races the next connect — observed on
        # Windows as WinError 10054/10053 and, under full-suite load,
        # intermittently as a failed second read. Closing per response makes
        # every exchange a discrete transaction with nothing to race.
        # Content-Length is still sent, so the client never has to infer the
        # body length from the close.
        protocol_version = "HTTP/1.0"

        def do_GET(self):
            parsed = urlparse(self.path)
            sym = parsed.path.rsplit("/", 1)[-1].upper()
            qs = parse_qs(parsed.query)
            source = (qs.get("source") or ["stocks"])[0]
            seen.append((sym, source))

            if state["status"] != 200:
                body = b"nope"
                self.send_response(state["status"])
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)
                return

            rows = state["rows"].get((source, sym), [])
            text = "\r\n".join([_HEADER] + rows) + "\r\n"
            body = gzip.compress(text.encode("utf-8"))
            self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), _H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("SIGNATURE_FLOW_BASE", f"http://127.0.0.1:{srv.server_address[1]}")

    class _Ctl:
        requests = seen

        @staticmethod
        def seed(source, sym, rows):
            state["rows"][(source, sym.upper())] = rows

        @staticmethod
        def fail(status=500):
            state["status"] = status

    try:
        yield _Ctl
    finally:
        srv.shutdown()
        srv.server_close()


# ── fixtures shared by both readers ─────────────────────────────────────────

_BREAKOUT_DAY = "6/21/2026"          # bar index 20 below == 2026-06-21


def _bars(n=22, breakout_at=20):
    """`n` daily bars keyed YYYYMMDD; `breakout_at` closes above the 20-bar high
    on 4x volume — comfortably clear of FCB_VOL_MULT either side of the tune."""
    start = date(2026, 6, 1)
    out = []
    for i in range(n):
        d = start + timedelta(days=i)
        bar = {"t": int(d.strftime("%Y%m%d")), "o": 95.0, "h": 100.0,
               "l": 90.0, "c": 95.0, "v": 1000}
        if i == breakout_at:
            bar.update({"h": 106.0, "c": 105.0, "v": 4000})
        out.append(bar)
    return out


def _confirming_flow(sym):
    """Call premium heavy enough to satisfy FCB_MIN_CALL_PREM + FCB_DOMINANCE."""
    return [_csv_row(CreatedDate=_BREAKOUT_DAY, Symbol=sym, CallPut="C", Premium="$1.2M"),
            _csv_row(CreatedDate=_BREAKOUT_DAY, Symbol=sym, CallPut="P", Premium="50000")]


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(ledger, "_DB_PATH", str(tmp_path / "ledger.db"))
    monkeypatch.setattr(ledger, "_INITED", False)
    for slot in (sig._DPL_STALE, sig._FCB_STALE, sig._GXW_STALE):
        slot._slots.clear()
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: _bars())
    app = FastAPI()
    app.include_router(sig.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {
        "id": "u1", "role": "user", "plan": "premium"}
    return app


# ── the router path ─────────────────────────────────────────────────────────

def test_the_router_finds_an_index_symbol_under_the_indexes_source(client, flow_source_server):
    """SPY's flow exists — under `indexes`. Asking only the default source
    returns a header and nothing else, which the compute reads as a quiet tape:
    no error, no signal, forever."""
    flow_source_server.seed("indexes", "SPY", _confirming_flow("SPY"))

    r = TestClient(client).get("/api/signature/flow-breakout?sym=SPY")

    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["direction"] for s in body["signals"]] == ["bull"], body
    assert flow_source_server.requests == [("SPY", "stocks"), ("SPY", "indexes")]


def test_a_stocks_side_symbol_never_asks_the_second_source(client, flow_source_server):
    """The fallback is a fallback. A real stock — the overwhelming majority of
    reads — must still cost exactly ONE request; a reader that always asked both
    would double the flow-service load for every chart open and still pass the
    test above."""
    flow_source_server.seed("stocks", "NVDA", _confirming_flow("NVDA"))

    r = TestClient(client).get("/api/signature/flow-breakout?sym=NVDA")

    assert [s["direction"] for s in r.json()["signals"]] == ["bull"], r.text
    assert flow_source_server.requests == [("NVDA", "stocks")]


def test_a_symbol_absent_from_both_sources_is_a_quiet_tape_not_an_error(client, flow_source_server):
    """Both asked, nothing found — that is an ANSWER (`signals: []`), not a
    failure envelope, and it must not be a third request either."""
    r = TestClient(client).get("/api/signature/flow-breakout?sym=ZZZZ")

    assert r.status_code == 200, r.text
    assert r.json()["signals"] == []
    assert flow_source_server.requests == [("ZZZZ", "stocks"), ("ZZZZ", "indexes")]


def test_a_failed_read_is_not_retried_as_if_it_were_zero_rows(client, flow_source_server):
    """A 500 is not an empty tape. Retrying it against the other source would
    turn one outage into two requests and — worse — let the second empty parse
    be reported as a legitimate 'no signal'."""
    flow_source_server.fail(500)

    r = TestClient(client).get("/api/signature/flow-breakout?sym=SPY")

    assert r.json().get("error"), r.text
    assert "signals" not in r.json()
    assert flow_source_server.requests == [("SPY", "stocks")]


# ── the sweep path ──────────────────────────────────────────────────────────
# The nightly sweep's DEFAULT symbol list leads with SPY and QQQ, so this reader
# being stocks-only meant the ledger's two headline names could never accrue.

def test_the_sweep_finds_an_index_symbol_under_the_indexes_source(flow_source_server):
    flow_source_server.seed("indexes", "SPY", _confirming_flow("SPY"))

    by_date = sweep_mod._fetch_flow_by_date("SPY", "2026-06-01")

    assert list(by_date) == ["2026-06-21"], by_date
    assert [r["CallPut"] for r in by_date["2026-06-21"]] == ["C", "P"]
    assert flow_source_server.requests == [("SPY", "stocks"), ("SPY", "indexes")]


def test_the_sweep_records_a_signal_for_an_index_symbol(tmp_path, monkeypatch, flow_source_server):
    """End to end through `run_sweep`, because the fetch returning rows and the
    ledger gaining a row are different claims."""
    monkeypatch.setattr(ledger, "_DB_PATH", str(tmp_path / "ledger.db"))
    monkeypatch.setattr(ledger, "_INITED", False)
    monkeypatch.setattr(sweep_mod, "_expected_session", lambda: 19000101)
    flow_source_server.seed("indexes", "SPY", _confirming_flow("SPY"))

    res = sweep_mod.run_sweep(
        ["SPY"], fetch_bars=lambda s: _bars(),
        fetch_flow=sweep_mod._fetch_flow_by_date, now_iso="2026-08-03")

    assert res["recorded"] == 1, res
    assert [r["sym"] for r in ledger.get_signals("SPY")] == ["SPY"]


def test_the_sweeps_stocks_hit_costs_exactly_one_request(flow_source_server):
    flow_source_server.seed("stocks", "NVDA", _confirming_flow("NVDA"))

    by_date = sweep_mod._fetch_flow_by_date("NVDA", "2026-06-01")

    assert list(by_date) == ["2026-06-21"]
    assert flow_source_server.requests == [("NVDA", "stocks")]


def test_the_sweeps_failed_read_still_raises_and_does_not_retry(flow_source_server):
    """`_fetch_flow_by_date` raising is what makes the pass count an `error`
    instead of scoring an outage as a scanned, signal-free night."""
    flow_source_server.fail(503)

    with pytest.raises(Exception):
        sweep_mod._fetch_flow_by_date("SPY", "2026-06-01")

    assert flow_source_server.requests == [("SPY", "stocks")]
