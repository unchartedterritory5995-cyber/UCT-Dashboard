"""The AI-search flow context read the wrong source for index/ETF symbols.

`/api/flow/ticker/{sym}` takes `?source=` and defaults to `stocks`, but the flow
DB files SPY, QQQ, IWM and every XL* — ~200 index/ETF names — under
`source=indexes`. `_ctx_flow_ticker` asked for the default only, so for exactly
the symbols a user is most likely to ask "what did the flow say on SPY?" about,
the surface answered 200 with a header and no rows, the summary came back empty,
and the model answered ungrounded — with no error anywhere to notice.

Same fix shape as the Signature readers (`d2033859`): a fallback, not a symbol
list. Ask `stocks`; only if the PARSE yields zero rows, ask `indexes` once.
Membership is upstream's to change and a hardcoded list would drift out of date
without ever failing, while a reader that always asked both would double
flow-service load for every grounded question and still look correct — which is
what the request counter on the server below is for.

A read FAILURE is not zero rows (`lesson_market_cap_cache_poison`): a 500 is an
outage, not a quiet tape, so it short-circuits before the retry rather than
being re-asked against — and reported as — the other source.

The server is real (gzipped CSV over HTTP, keyed off `flow_db.COLUMNS`), not an
injected stub: the entire behaviour under test is a query parameter on a wire
request, and a stub proves nothing about what actually got sent
(`lesson_injected_dependency_hides_the_fetch`).
"""
import gzip
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from api.flow_db import COLUMNS
from api.routers import ai_search


def _csv_row(**kv) -> str:
    """One row in the REAL column order the surface emits."""
    return ",".join(str(kv.get(c, "")) for c in COLUMNS)


_HEADER = ",".join(COLUMNS)

# A closed session, deliberately NOT today: `_summarize_flow_rows` then takes
# its "last session" branch, so this test is not a weekday/holiday time bomb
# (`lesson_weekday_only_test_time_bombs`).
_DAY = "6/21/2026"


def _prints(sym):
    """Premium heavy enough to summarize, in the PLAIN-number shape this reader
    parses (`float(row["Premium"])` — it does not decode `$1.2M`)."""
    return [_csv_row(CreatedDate=_DAY, Symbol=sym, CallPut="C", Side="ASK",
                     Premium="1200000", Strike="500", ExpirationDate="7/18/2026"),
            _csv_row(CreatedDate=_DAY, Symbol=sym, CallPut="P", Side="BID",
                     Premium="50000", Strike="480", ExpirationDate="7/18/2026")]


@pytest.fixture
def flow_source_server(monkeypatch):
    """A real flow surface that FILTERS by `?source=`, and counts what it saw.

    Mirrors `flow_db.stream_csv_symbol`: always the header, then only the rows
    matching (source, symbol) — so "no rows for this source" arrives as a
    perfectly valid 200 with a header and nothing else, exactly as production
    does. That shape IS the bug: indistinguishable from a quiet tape unless you
    ask the other source.

    HTTP/1.0 + explicit `Connection: close` for the same reason as the Signature
    twin of this fixture: these tests make TWO sequential requests, which is
    exactly what a keep-alive connection is stateful across, and teardown then
    races the next connect (WinError 10054 on Windows). Content-Length is still
    sent, so the client never infers body length from the close.
    """
    state = {"rows": {}, "status": 200}
    seen = []

    class _H(BaseHTTPRequestHandler):
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
    port = srv.server_address[1]

    # Point the reader's OWN resolver at the server rather than replacing it —
    # `_flow_base_url()` falls through to 127.0.0.1:$PORT when the flow proxy is
    # off, so the real URL-building code still runs.
    monkeypatch.setenv("PORT", str(port))
    try:
        from api import flow_proxy
        monkeypatch.setattr(flow_proxy, "PROXY_ENABLED", False, raising=False)
    except Exception:                                   # noqa: BLE001
        pass
    assert ai_search._flow_base_url() == f"http://127.0.0.1:{port}"

    # The 60s memo is module state: without this a symbol read in one test
    # answers from cache in the next and the request counter stays empty.
    ai_search._flow_ctx_memo.clear()

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
        ai_search._flow_ctx_memo.clear()
        srv.shutdown()
        srv.server_close()


def test_an_index_symbol_is_found_under_the_indexes_source(flow_source_server):
    """SPY's flow exists — under `indexes`. Asking only the default source gets
    a header and nothing else, which this reader turns into an empty string: the
    model then answers about SPY flow with no flow at all, and nothing logs."""
    flow_source_server.seed("indexes", "SPY", _prints("SPY"))

    text = ai_search._ctx_flow_ticker("SPY")

    assert text.startswith("SPY options flow"), text
    assert "$1.2M premium" in text, text
    assert flow_source_server.requests == [("SPY", "stocks"), ("SPY", "indexes")]


def test_a_stocks_side_symbol_never_asks_the_second_source(flow_source_server):
    """The fallback is a fallback. A real stock — the overwhelming majority of
    reads — must still cost exactly ONE request; a reader that always asked both
    would double flow-service load per grounded question and still pass the test
    above. This runs on a 2.5s budget inside a user-facing answer."""
    flow_source_server.seed("stocks", "NVDA", _prints("NVDA"))

    text = ai_search._ctx_flow_ticker("NVDA")

    assert text.startswith("NVDA options flow"), text
    assert flow_source_server.requests == [("NVDA", "stocks")]


def test_a_symbol_absent_from_both_sources_is_quiet_not_a_third_request(flow_source_server):
    """Both asked, nothing found — an empty context is the honest answer, and
    it must not become a third request."""
    assert ai_search._ctx_flow_ticker("ZZZZ") == ""
    assert flow_source_server.requests == [("ZZZZ", "stocks"), ("ZZZZ", "indexes")]


def test_a_failed_read_is_not_retried_as_if_it_were_zero_rows(flow_source_server):
    """A 500 is not an empty tape. Retrying it against the other source turns one
    outage into two requests on a latency-budgeted path, and would let the second
    empty parse be reported as a legitimate 'no notable flow'."""
    flow_source_server.fail(500)

    assert ai_search._ctx_flow_ticker("SPY") == ""
    assert flow_source_server.requests == [("SPY", "stocks")]
