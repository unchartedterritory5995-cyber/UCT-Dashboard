"""The whole-market snapshot helper process (api/services/snapshot_hl.py).

What must stay true:
  * ONE row rule: the helper path and the in-process path give the same dict, value for value and
    type for type, in the same key order.
  * Switch off: no process is ever started.
  * The vendor failing is `{}` (no second pull); the HELPER failing falls back to the in-process path
    and is not retried for RETRY_AFTER_S.
  * The request URL (it carries the vendor key) never reaches the child's stderr.
"""
import http.server
import json
import subprocess
import threading
import time

import pytest

from api.services import massive, snapshot_hl

KEY = "s3cr3t-key-value"

PAYLOAD = {"tickers": [
    {"ticker": "AAA", "day": {"h": 10.123456, "l": 9.5, "o": 9.75, "c": 10.0, "v": 1234567.0},
     "prevDay": {"c": 9.4, "v": 2000000}, "lastTrade": {"p": 10.05555}, "min": {"c": 10.04, "av": 1300000, "v": 4200}},
    {"ticker": "NOLAST", "day": {"c": 5.25, "h": 0, "l": 0}, "prevDay": {"c": 5.0, "v": 10}, "lastTrade": {}, "min": {}},
    {"ticker": "PREVONLY", "prevDay": {"c": 3.3333333}},
    {"ticker": "", "day": {"c": 1.0}},
    {"day": {"c": 2.0}},
    {"ticker": "NULLS", "day": {"h": None, "l": None, "o": None, "c": None, "v": None},
     "prevDay": {"c": None, "v": None}, "lastTrade": {"p": None}, "min": {"c": None, "av": None, "v": None}},
    {"ticker": "BRK.B", "day": {"h": 500.0, "l": 495.5, "o": 496.0, "c": 499.99, "v": 9e9},
     "prevDay": {"c": 498.0, "v": 3_000_000_000}, "lastTrade": {"p": 499.5}, "min": {"c": 499.6, "av": 9_100_000_000, "v": 1}},
]}

EXPECTED_AAA = {"last_price": 10.0556, "prev_close": 9.4, "prev_vol": 2000000, "today_vol": 1234567,
                "day_high": 10.1235, "day_low": 9.5, "day_open": 9.75, "day_c": 10.0, "min_c": 10.04,
                "last_trade_p": 10.0556, "min_av": 1300000, "min_v": 4200}


def _typed(rows):
    return {k: [(name, type(v).__name__, v) for name, v in r.items()] for k, r in rows.items()}


class _Vendor:
    """A local stand-in for the vendor: serves PAYLOAD, or an error, or answers late."""

    def __init__(self):
        self.mode, self.hits, self.paths = "ok", 0, []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                outer.hits += 1
                outer.paths.append(self.path)
                if outer.mode == "slow":
                    time.sleep(3.0)
                if outer.mode == "error":
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(b"boom " + self.path.encode())
                    return
                body = b"not json" if outer.mode == "garbage" else json.dumps(PAYLOAD).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = "http://127.0.0.1:%d/v2/snapshot?apiKey=%s" % (self.server.server_address[1], KEY)

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture()
def vendor():
    v = _Vendor()
    yield v
    v.close()


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv(snapshot_hl.ENV, raising=False)
    snapshot_hl._reset_for_tests()
    yield
    snapshot_hl._reset_for_tests()


# ── the row rule ──────────────────────────────────────────────────────────────

def test_row_rule_golden():
    rows = snapshot_hl.rows_from_payload(PAYLOAD)
    assert list(rows) == ["AAA", "NOLAST", "PREVONLY", "NULLS", "BRK.B"]          # nameless tickers skipped
    assert rows["AAA"] == EXPECTED_AAA and list(rows["AAA"]) == list(snapshot_hl.ROW_KEYS)
    assert rows["NOLAST"]["last_price"] == 5.25 and rows["NOLAST"]["last_trade_p"] == 0.0   # falls to day.c
    assert rows["PREVONLY"]["last_price"] == 3.3333 and rows["PREVONLY"]["day_high"] == 0.0  # falls to prevDay.c
    assert set(rows["NULLS"].values()) == {0.0, 0}
    assert rows["BRK.B"]["today_vol"] == 9_000_000_000 and isinstance(rows["BRK.B"]["today_vol"], int)


def test_pack_unpack_is_exact_values_types_and_order():
    rows = snapshot_hl.rows_from_payload(PAYLOAD)
    back = snapshot_hl.unpack(snapshot_hl.pack(rows))
    assert _typed(back) == _typed(rows)
    assert list(back) == list(rows)
    assert snapshot_hl.unpack(snapshot_hl.pack({})) == {}


def test_unpack_refuses_a_frame_that_disagrees_with_its_header():
    frame = snapshot_hl.pack(snapshot_hl.rows_from_payload(PAYLOAD))
    with pytest.raises(ValueError):
        snapshot_hl.unpack(frame[:-8])


# ── the helper process, for real ──────────────────────────────────────────────

def test_helper_answer_equals_the_in_process_answer(vendor):
    got = snapshot_hl.fetch_rows(vendor.url, timeout=30)
    assert _typed(got) == _typed(snapshot_hl.rows_from_payload(PAYLOAD))
    again = snapshot_hl.fetch_rows(vendor.url, timeout=30)
    assert again == got
    st = snapshot_hl.stats()
    assert st["ok"] == 2 and st["spawns"] == 1 and st["running"] and st["last_rows"] == 5   # one process, reused


def test_vendor_error_is_empty_and_not_a_helper_failure(vendor):
    vendor.mode = "error"
    assert snapshot_hl.fetch_rows(vendor.url, timeout=30) == {}
    vendor.mode = "garbage"
    assert snapshot_hl.fetch_rows(vendor.url, timeout=30) == {}
    st = snapshot_hl.stats()
    assert st["fetch_errors"] == 2 and st["unavailable"] == 0 and st["running"]
    vendor.mode = "ok"
    assert len(snapshot_hl.fetch_rows(vendor.url, timeout=30)) == 5                # same process recovers


def test_the_key_never_reaches_the_childs_stderr(vendor, monkeypatch, tmp_path):
    errfile = open(tmp_path / "child.err", "wb")
    monkeypatch.setattr(snapshot_hl, "_child_stderr", errfile)
    vendor.mode = "error"
    assert snapshot_hl.fetch_rows(vendor.url, timeout=30) == {}
    snapshot_hl.stop()
    errfile.close()
    text = (tmp_path / "child.err").read_text(errors="replace")
    assert "fetch failed" in text                    # the control: the child did write its line
    assert KEY not in text and "apiKey" not in text


def test_a_failed_fetch_reports_the_error_type_and_never_its_text():
    url = "https://vendor.example/v2/snapshot?apiKey=" + KEY

    def get(u):
        raise RuntimeError("Server error '500' for url '%s'" % u)   # what an HTTP library's error says
    status, frame, line = snapshot_hl._answer(url, get, json.loads)
    assert (status, frame) == (snapshot_hl._FETCH_ERROR, b"")
    assert "RuntimeError" in line and KEY not in line and "apiKey" not in line
    ok = snapshot_hl._answer(url, lambda u: json.dumps(PAYLOAD).encode(), json.loads)
    assert ok[0] == snapshot_hl._OK and ok[2] is None and len(snapshot_hl.unpack(ok[1])) == 5


def test_no_answer_in_time_is_unavailable_and_the_helper_is_stopped(vendor):
    vendor.mode = "slow"
    with pytest.raises(snapshot_hl.ChildUnavailable):
        snapshot_hl.fetch_rows(vendor.url, timeout=0.5)
    st = snapshot_hl.stats()
    assert st["unavailable"] == 1 and not st["running"]


def test_a_dead_helper_is_unavailable_then_not_retried_until_the_clock_allows(vendor, monkeypatch):
    assert len(snapshot_hl.fetch_rows(vendor.url, timeout=30)) == 5
    snapshot_hl._child.proc.kill()
    snapshot_hl._child.proc.wait(timeout=10)
    with pytest.raises(snapshot_hl.ChildUnavailable):
        snapshot_hl.fetch_rows(vendor.url, timeout=5)
    spawns = snapshot_hl.stats()["spawns"]
    with pytest.raises(snapshot_hl.ChildUnavailable, match="waiting to retry"):
        snapshot_hl.fetch_rows(vendor.url, timeout=5)
    assert snapshot_hl.stats()["spawns"] == spawns                                  # no spawn storm
    monkeypatch.setattr(snapshot_hl, "_retry_at", 0.0)
    assert len(snapshot_hl.fetch_rows(vendor.url, timeout=30)) == 5                # and it comes back
    assert snapshot_hl.stats()["spawns"] == spawns + 1


def test_a_helper_that_cannot_start_is_unavailable(monkeypatch):
    monkeypatch.setattr(snapshot_hl, "_command", lambda: ["no-such-interpreter-anywhere", "--child"])
    with pytest.raises(snapshot_hl.ChildUnavailable):
        snapshot_hl.fetch_rows("http://127.0.0.1:9/x", timeout=5)


# ── massive.get_full_market_snapshot_hl ───────────────────────────────────────

class _Client(massive._MassiveRestClient):
    def __init__(self):          # no key, no network
        self._api_key = KEY
        self.calls = 0

    def _get(self, url, timeout=None):
        self.calls += 1
        return PAYLOAD


def test_switch_off_never_starts_a_process(monkeypatch):
    started = []

    def _no(*a, **k):
        started.append(a)
        raise OSError("no process may start with the switch off")
    monkeypatch.setattr(subprocess, "Popen", _no)
    c = _Client()
    assert c.get_full_market_snapshot_hl()["AAA"] == EXPECTED_AAA
    # `started` is the proof: a refused start is swallowed into the fallback, so the answer alone
    # would look the same with the switch ignored.
    assert started == [] and c.calls == 1
    assert snapshot_hl.stats()["spawns"] == 0 and snapshot_hl.stats()["unavailable"] == 0


def test_switch_on_uses_the_helper_and_not_the_in_process_pull(monkeypatch, vendor):
    monkeypatch.setenv(snapshot_hl.ENV, "1")
    monkeypatch.setattr(massive, "_REST_BASE", vendor.url.split("/v2/")[0])
    c = _Client()
    got = c.get_full_market_snapshot_hl()
    assert _typed(got) == _typed(snapshot_hl.rows_from_payload(PAYLOAD))
    assert c.calls == 0 and vendor.hits == 1
    assert vendor.paths[0].endswith("/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=" + KEY)


def test_switch_on_with_a_broken_helper_falls_back_to_the_in_process_pull(monkeypatch):
    monkeypatch.setenv(snapshot_hl.ENV, "1")
    monkeypatch.setattr(snapshot_hl, "_command", lambda: ["no-such-interpreter-anywhere", "--child"])
    c = _Client()
    assert c.get_full_market_snapshot_hl()["AAA"] == EXPECTED_AAA
    assert c.get_full_market_snapshot_hl()["AAA"] == EXPECTED_AAA
    # One failed start; the second call is inside the retry wait, so no second start is attempted.
    assert c.calls == 2 and snapshot_hl.stats()["unavailable"] == 1 and snapshot_hl.stats()["spawns"] == 0


def test_in_process_vendor_error_is_still_empty():
    class _Down(_Client):
        def _get(self, url, timeout=None):
            raise RuntimeError("vendor down")
    assert _Down().get_full_market_snapshot_hl() == {}
