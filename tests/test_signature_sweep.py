"""The nightly closed-bar sweep — what makes the ledger accrue from launch day.

The request path (`/api/signature/flow-breakout`) only ever records a signal for
a symbol somebody happened to LOOK at, and only for bars that are already
closed-and-superseded. That is a receipt book with holes in it: on launch day
the ledger is empty, and it stays empty for every name nobody charted.

This sweep runs POST-close and walks a fixed symbol list whether or not a user
ever opened a chart.

Four properties this file exists to hold:

* **The final bar is evaluated — but ONLY when it is actually final.**
  `bars.db` holds today's *evolving* partial daily bar; it is refreshed by user
  fetches, not by a clock, so "the last row" and "the closed session" are not
  the same thing. `include_last` is therefore gated on the store's last bar
  matching the session the calendar says should exist. The ledger is
  append-only with no rewrite path, so a signal recorded off a 15:52 snapshot
  that the real close took back is permanent.
* **Nothing in one symbol — or one signal — can end the pass.** A dead provider
  and a ledger refusal are both routine; they cost their own row and nothing
  else. `errors` is the receipt that they happened, `stale` the receipt that a
  store was behind.
* **Re-running is free.** Which is what makes the market-holiday case a no-op
  needing no calendar: the sweep re-sees the last session's bar, the ledger's
  UNIQUE key refuses it, `recorded` is 0. Nobody should ever "fix" this with a
  holiday guard.
* **The flow read never materializes what it will not use.** SPY/QQQ carry a
  90-day uncapped history over 22 columns; the sweep keeps three of them, and
  only inside the bar window it is about to join against.
"""
import ast
import gzip
import json
import threading
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from api.services.signature import ledger
from api.services.signature import sweep as sweep_mod
from api.services.signature.flow_breakout import _bar_date_iso, fcb_signals
from api.services.signature.sweep import run_sweep

_ET = ZoneInfo("America/New_York")


@pytest.fixture
def tmp_ledger(tmp_path, monkeypatch):
    """Point the ledger at a throwaway file.

    BOTH the env var and the module constant, mirroring
    `test_signature_ledger.tmp_ledger`: `_DB_PATH` is read at import, so the env
    alone would not move an already-imported module, and the constant alone
    would leave a re-import reading `/data`. Nothing in this suite may touch the
    live ledger.
    """
    p = tmp_path / "l.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_INITED", False)
    return p


# ── bar fixtures ────────────────────────────────────────────────────────────
# Daily bars key on a YYYYMMDD int (`bars_sqlite`), which is what production
# hands the sweep — so that is what the fixtures use. The epoch encoding gets
# ONE dedicated test rather than standing in for the daily path everywhere.

def _sessions(n: int, start=date(2026, 6, 1)) -> list[int]:
    """`n` consecutive weekdays as YYYYMMDD ints (business-day shaped; holidays
    are not modelled — nothing under test validates that a date is a real
    session, only that the encoding and the ordering are the store's)."""
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += timedelta(days=1)
    return out


_SESSIONS = _sessions(27)


def _bars_with_final_breakout():
    """25 quiet bars, then a volume-backed breakout that IS the last bar."""
    base = 100.0
    bars = [{"t": _SESSIONS[i], "o": base, "h": base + 1, "l": base - 1,
             "c": base, "v": 1_000_000} for i in range(25)]
    bars.append({"t": _SESSIONS[25], "o": base, "h": base + 5, "l": base,
                 "c": base + 4, "v": 2_000_000})
    return bars


def _bars_with_two_breakouts():
    """…and then a second breakout above the first — two signals, one symbol.

    Needed twice over: to prove the ledger guard is PER SIGNAL (with one signal
    per symbol a per-symbol guard is indistinguishable), and to prove a stale
    store still evaluates the EARLIER confirmed bar while skipping the last one.
    """
    bars = _bars_with_final_breakout()
    bars.append({"t": _SESSIONS[26], "o": 104.0, "h": 110.0, "l": 104.0,
                 "c": 109.0, "v": 2_000_000})
    return bars


def _bars_epoch_with_final_breakout():
    """The intraday/unix encoding — `_bar_date_iso`'s third branch."""
    base = 100.0
    bars = [{"t": 86400 * i, "o": base, "h": base + 1, "l": base - 1,
             "c": base, "v": 1_000_000} for i in range(25)]
    bars.append({"t": 86400 * 25, "o": base, "h": base + 5, "l": base,
                 "c": base + 4, "v": 2_000_000})
    return bars


def _quiet_bars():
    return [{"t": _SESSIONS[i], "o": 100.0, "h": 101.0, "l": 99.0,
             "c": 100.0, "v": 1_000_000} for i in range(26)]


def _ymd(bar_t) -> int:
    """The YYYYMMDD session key for a bar timestamp, whatever its encoding."""
    return int(_bar_date_iso(bar_t).replace("-", ""))


_CALL_ROW = {"CallPut": "CALL", "Premium": "900000"}


def _flow_on(bars, *indices):
    """Confirming call flow on the sessions of the given bar indices."""
    return {_bar_date_iso(bars[i]["t"]): [dict(_CALL_ROW)] for i in indices}


# ── the session calendar the freshness gate reads ───────────────────────────

@pytest.fixture(autouse=True)
def store_current_through(monkeypatch):
    """Pin the expected latest session; default = the standard fixture's last bar.

    Production reads the real NYSE-aware calendar
    (`bars_fetch._expected_latest_session_yyyymmdd`). Pinning it here is not
    convenience: unpinned, every freshness assertion in this file would depend
    on the day and hour the suite happens to run — the weekday-only time-bomb
    class. Returns a setter so a test can put the store BEHIND deliberately.
    """
    real = sweep_mod._expected_session
    state = {"value": _SESSIONS[25]}
    monkeypatch.setattr(sweep_mod, "_expected_session", lambda: state["value"])

    def _set(v):
        state["value"] = v

    _set.real = real          # the UNPATCHED function, for the delegation test
    return _set


def _kwargs(bars=None, flow=None, now_iso="2026-08-03"):
    bars = _bars_with_final_breakout() if bars is None else bars
    flow = _flow_on(bars, 25) if flow is None else flow
    return dict(fetch_bars=lambda s: bars, fetch_flow=lambda s, c: flow, now_iso=now_iso)


# ── the brief's contract ────────────────────────────────────────────────────

def test_sweep_records_final_bar_signal(tmp_ledger):
    bars = _bars_with_final_breakout()
    flow = _flow_on(bars, 25)
    res = run_sweep(["NVDA"], fetch_bars=lambda s: bars,
                    fetch_flow=lambda s, c: flow, now_iso="2026-08-03")
    assert res == {"symbols": 1, "scanned": 1, "recorded": 1, "errors": 0, "stale": 0}
    assert len(ledger.get_signals("NVDA")) == 1


def test_sweep_is_idempotent(tmp_ledger):
    kwargs = _kwargs()
    run_sweep(["NVDA"], **kwargs)
    res2 = run_sweep(["NVDA"], **kwargs)
    assert res2["recorded"] == 0 and len(ledger.get_signals("NVDA")) == 1


def test_sweep_survives_a_bad_symbol(tmp_ledger):
    good = _bars_with_final_breakout()

    def bars(s):
        if s == "BAD":
            raise RuntimeError("boom")
        return good

    res = run_sweep(["BAD", "NVDA"], fetch_bars=bars,
                    fetch_flow=lambda s, c: _flow_on(good, 25), now_iso="2026-08-03")
    assert res["errors"] == 1 and res["recorded"] == 1
    assert res["symbols"] == 2 and res["scanned"] == 1


# ── F1: the last bar is only trusted when it IS the closed session ──────────

def test_the_sweep_sees_a_bar_the_request_path_cannot(tmp_ledger):
    """A CURRENT store is the whole reason this job exists.

    The same bars through the request path's `include_last=False` find NOTHING.
    """
    bars = _bars_with_final_breakout()
    assert fcb_signals(bars, _flow_on(bars, 25), include_last=False) == []
    assert run_sweep(["NVDA"], **_kwargs(bars))["recorded"] == 1


def test_a_store_behind_the_session_never_records_off_its_last_bar(
        tmp_ledger, store_current_through):
    """bars.db holds today's EVOLVING partial bar — refreshed by user fetches,
    not by a clock. If the store's newest row is not the session the calendar
    says should exist, that row cannot be trusted as closed, and the ledger has
    no rewrite path for a signal the real close takes back.

    Earlier bars are unaffected: they are confirmed by a later bar existing.
    """
    bars = _bars_with_two_breakouts()
    store_current_through(_ymd(bars[-2]["t"]))          # store is a session behind

    res = run_sweep(["NVDA"], **_kwargs(bars, _flow_on(bars, 25, 26)))

    assert res == {"symbols": 1, "scanned": 1, "recorded": 1, "errors": 0, "stale": 1}
    rows = ledger.get_signals("NVDA")
    assert [r["bar_time"] for r in rows] == [_ymd(bars[25]["t"])]
    assert _ymd(bars[26]["t"]) not in {r["bar_time"] for r in rows}


def test_a_current_store_records_both_including_the_last(tmp_ledger, store_current_through):
    """The other direction — so the gate cannot be 'fixed' into never trusting
    the last bar, which would silently reduce the sweep to the request path."""
    bars = _bars_with_two_breakouts()
    store_current_through(_ymd(bars[-1]["t"]))

    res = run_sweep(["NVDA"], **_kwargs(bars, _flow_on(bars, 25, 26)))

    assert res == {"symbols": 1, "scanned": 1, "recorded": 2, "errors": 0, "stale": 0}
    assert {r["bar_time"] for r in ledger.get_signals("NVDA")} == {
        _ymd(bars[25]["t"]), _ymd(bars[26]["t"])}


def test_the_stale_count_separates_a_behind_store_from_a_quiet_night(
        tmp_ledger, store_current_through):
    """`recorded: 0` means two very different things. Without `stale` a night
    where every store was behind is indistinguishable from a night with no
    setups — and the first one is an outage."""
    store_current_through(19000101)                     # nothing can be current
    res = run_sweep(["NVDA", "AMD"], **_kwargs())
    assert res == {"symbols": 2, "scanned": 2, "recorded": 0, "errors": 0, "stale": 2}


def test_a_symbol_with_no_bars_is_stale_not_a_crash(tmp_ledger):
    res = run_sweep(["NEW"], fetch_bars=lambda s: [],
                    fetch_flow=lambda s, c: {}, now_iso="2026-08-03")
    assert res == {"symbols": 1, "scanned": 1, "recorded": 0, "errors": 0, "stale": 1}


def test_the_expected_session_comes_from_the_bars_store_calendar(store_current_through):
    """The gate is only as good as the calendar behind it — and a wrapper that
    quietly stopped delegating would make every symbol look current forever.

    Asserted against the REAL, unpatched function (holiday + pre-open rolls
    included), reached through the fixture that shadows it everywhere else.
    """
    from api.services import bars_fetch
    assert store_current_through.real() == bars_fetch._expected_latest_session_yyyymmdd()

    # A Saturday resolves back to Friday — proof it is the session calendar and
    # not `date.today()` wearing its name.
    sat = datetime(2026, 8, 8, 12, 0, tzinfo=_ET)
    assert bars_fetch._expected_latest_session_yyyymmdd(sat) == 20260807


def test_a_market_holiday_is_a_clean_no_op_and_needs_no_guard(tmp_ledger):
    """On a holiday the calendar rolls BACK to the last real session and the
    store's newest bar is that same session — so the sweep re-evaluates it, the
    ledger's UNIQUE key refuses it, and the pass records 0. No calendar lookup,
    no holiday list, no skip logic in this module. This test exists so nobody
    later "fixes" a non-problem by adding one.
    """
    kwargs = _kwargs()
    first = run_sweep(["NVDA"], **kwargs)
    holiday = run_sweep(["NVDA"], **kwargs)       # identical bars — nothing new closed

    assert first["recorded"] == 1
    assert holiday == {"symbols": 1, "scanned": 1, "recorded": 0, "errors": 0, "stale": 0}
    assert len(ledger.get_signals("NVDA")) == 1


# ── ledger seam ─────────────────────────────────────────────────────────────

def test_the_row_carries_the_product_facing_timeframe_and_the_raw_bar_time(tmp_ledger):
    """`tf` is "1D" — the product label — never the bars-store key "D"."""
    run_sweep(["nvda"], **_kwargs())
    row = ledger.get_signals("NVDA")[0]
    assert row["tf"] == "1D"
    assert row["bar_time"] == _SESSIONS[25]
    assert row["indicator"] == "fcb" and row["version"] == "fcb-v2"
    assert row["direction"] == "bull" and row["sym"] == "NVDA"


def test_the_epoch_bar_encoding_is_passed_through_raw(tmp_ledger, store_current_through):
    """The one epoch-branch test. It is also where the "caller must not
    pre-normalize" rail lives: under the YYYYMMDD encoding the ledger maps a
    pre-formatted ISO string back onto the SAME int, so only this encoding can
    observe the difference (2160000 vs 19700126).
    """
    bars = _bars_epoch_with_final_breakout()
    store_current_through(_ymd(bars[-1]["t"]))
    run_sweep(["NVDA"], **_kwargs(bars, _flow_on(bars, 25)))
    assert ledger.get_signals("NVDA")[0]["bar_time"] == 86400 * 25


def test_the_meta_carries_both_premiums_and_the_sweep_date(tmp_ledger):
    run_sweep(["NVDA"], **_kwargs(now_iso="2026-08-03"))
    meta = json.loads(ledger.get_signals("NVDA")[0]["meta_json"])
    assert meta["callPrem"] == 900_000.0
    assert meta["putPrem"] == 0.0
    assert meta["sweep"] == "2026-08-03"


def test_one_refused_signal_does_not_cost_the_others(
        tmp_ledger, monkeypatch, store_current_through):
    """`record_signal` RAISES on anything it cannot key — by design.

    Guarding per SYMBOL is not enough: the first refusal would abandon every
    later signal for that symbol.
    """
    bars = _bars_with_two_breakouts()
    store_current_through(_ymd(bars[-1]["t"]))
    real, calls = ledger.record_signal, {"n": 0}

    def flaky(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ValueError("refused")
        return real(*a, **kw)

    monkeypatch.setattr(ledger, "record_signal", flaky)
    res = run_sweep(["NVDA"], **_kwargs(bars, _flow_on(bars, 25, 26)))

    assert calls["n"] == 2, "the second signal must still be attempted"
    assert res == {"symbols": 1, "scanned": 1, "recorded": 1, "errors": 1, "stale": 0}
    assert len(ledger.get_signals("NVDA")) == 1


def test_a_refusal_is_logged_loudly(tmp_ledger, monkeypatch, caplog):
    """A silently dropped receipt is worse than a missing one — it looks fine."""
    monkeypatch.setattr(ledger, "record_signal",
                        lambda *a, **kw: (_ for _ in ()).throw(ValueError("refused")))
    with caplog.at_level("ERROR", logger="signature.sweep"):
        res = run_sweep(["NVDA"], **_kwargs())
    assert res["errors"] == 1
    assert any(r.levelname == "ERROR" and "NVDA" in r.getMessage() for r in caplog.records)


def test_a_dead_symbol_is_logged_and_the_pass_continues(tmp_ledger, caplog):
    good = _bars_with_final_breakout()

    def bars(s):
        if s == "BAD":
            raise RuntimeError("boom")
        return good

    with caplog.at_level("ERROR", logger="signature.sweep"):
        res = run_sweep(["BAD", "NVDA", "AMD"], fetch_bars=bars,
                        fetch_flow=lambda s, c: _flow_on(good, 25), now_iso="2026-08-03")
    assert res == {"symbols": 3, "scanned": 2, "recorded": 2, "errors": 1, "stale": 0}
    assert any("BAD" in r.getMessage() for r in caplog.records)


def test_a_symbol_with_no_signal_is_still_a_clean_scan(tmp_ledger):
    """Quiet tape is an ANSWER. It must not read as an error."""
    res = run_sweep(["SPY"], **_kwargs(_quiet_bars(), {}))
    assert res == {"symbols": 1, "scanned": 1, "recorded": 0, "errors": 0, "stale": 0}


# ── F2: the flow read keeps three columns, inside the window only ───────────

_WIDE_COLS = ("CreatedDate", "CreatedTime", "Symbol", "CallPut", "Premium")


def _csv_lines(rows, cols=_WIDE_COLS) -> list[str]:
    return [",".join(cols)] + [",".join(str(r.get(c, "")) for c in cols) for r in rows]


def test_only_the_three_joined_columns_survive_and_the_window_is_enforced():
    """SPY/QQQ carry a 90-day uncapped history over 22 columns. Materializing
    full row dicts for all of it is a ~155MB transient on a 512MB pod, and the
    join reads exactly three fields inside exactly one window."""
    lines = _csv_lines([
        {"CreatedDate": "7/3/2026", "CreatedTime": "09:31", "Symbol": "NVDA",
         "CallPut": "CALL", "Premium": "900000"},
        {"CreatedDate": "6/1/2026", "CreatedTime": "10:00", "Symbol": "NVDA",
         "CallPut": "PUT", "Premium": "100"},                       # before the window
    ])
    by_date = sweep_mod.flow_by_date(lines, cutoff_iso="2026-07-01")

    assert list(by_date) == ["2026-07-03"]
    assert by_date["2026-07-03"] == [{"CreatedDate": "7/3/2026",
                                      "CallPut": "CALL", "Premium": "900000"}]
    assert set(by_date["2026-07-03"][0]) == set(sweep_mod.FLOW_COLS)


def test_without_a_cutoff_every_date_is_kept():
    lines = _csv_lines([{"CreatedDate": "6/1/2026", "CallPut": "PUT", "Premium": "1"},
                        {"CreatedDate": "7/3/2026", "CallPut": "CALL", "Premium": "2"}])
    assert sorted(sweep_mod.flow_by_date(lines)) == ["2026-06-01", "2026-07-03"]


def test_the_columns_are_resolved_by_NAME_not_position():
    """Upstream owns this CSV's column order (`flow_db.COLUMNS`). A positional
    read keeps working right up until someone inserts a column, and then joins
    a Symbol string as a premium — silently, toward no signal."""
    shuffled = ("Premium", "Symbol", "CallPut", "CreatedDate")
    lines = _csv_lines([{"CreatedDate": "7/3/2026", "Symbol": "NVDA",
                         "CallPut": "CALL", "Premium": "900000"}], cols=shuffled)
    assert sweep_mod.flow_by_date(lines)["2026-07-03"] == [
        {"CreatedDate": "7/3/2026", "CallPut": "CALL", "Premium": "900000"}]


def test_a_header_missing_a_joined_column_raises_rather_than_returning_nothing():
    lines = _csv_lines([{"CreatedDate": "7/3/2026", "Premium": "1"}],
                       cols=("CreatedDate", "Premium"))
    with pytest.raises(Exception):
        sweep_mod.flow_by_date(lines)


def test_an_empty_body_is_not_a_crash():
    assert sweep_mod.flow_by_date([]) == {}


# ── the flow date join ──────────────────────────────────────────────────────

def test_flow_dates_are_keyed_the_same_way_bar_dates_are():
    """The join is only as good as the agreement between these two functions,
    pinned on the DAILY encoding production actually uses.

    `_flow_by_date` normalizes the flow table's M/D/YYYY; `_bar_date_iso`
    normalizes the bar timestamp. If either drifts the join matches nothing and
    the indicator ships silently dead — there is no error anywhere.
    """
    lines = _csv_lines([{"CreatedDate": "7/3/2026", "CallPut": "CALL", "Premium": "1"}])
    assert list(sweep_mod.flow_by_date(lines)) == [_bar_date_iso(20260703)]


def test_flow_dates_are_zero_padded_and_garbage_is_skipped():
    lines = _csv_lines([{"CreatedDate": "7/3/2026"}, {"CreatedDate": "12/25/2026"},
                        {"CreatedDate": ""}, {"CreatedDate": "not-a-date"}])
    by_date = sweep_mod.flow_by_date(lines)
    assert sorted(by_date) == ["2026-07-03", "2026-12-25"]


def test_rows_on_the_same_day_are_grouped_not_replaced():
    lines = _csv_lines([{"CreatedDate": "7/3/2026", "Premium": "1"},
                        {"CreatedDate": "7/3/2026", "Premium": "2"}])
    assert len(sweep_mod.flow_by_date(lines)["2026-07-03"]) == 2


# ── the real flow read ──────────────────────────────────────────────────────

@pytest.fixture
def flow_server(monkeypatch):
    """A real HTTP server speaking the real surface: gzipped CSV.

    Not a mocked httpx — the whole point of this path is that it streams a
    Content-Encoding: gzip body and parses it line by line, and an injected
    stub proves none of that (`lesson_injected_dependency_hides_the_fetch`).
    """
    servers, seen = [], {}

    def make(csv_text: str, status: int = 200):
        payload = gzip.compress(csv_text.encode("utf-8"))

        class _H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                seen["path"] = self.path
                seen["headers"] = {k.lower(): v for k, v in self.headers.items()}
                body = payload if status == 200 else b"nope"
                self.send_response(status)
                self.send_header("Content-Type", "text/csv")
                if status == 200:
                    self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        srv = ThreadingHTTPServer(("127.0.0.1", 0), _H)
        servers.append(srv)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        monkeypatch.setenv("SIGNATURE_FLOW_BASE",
                           f"http://127.0.0.1:{srv.server_address[1]}")
        return seen

    yield make
    for s in servers:
        s.shutdown()
        s.server_close()


def test_the_real_flow_read_streams_gzipped_csv_and_forwards_no_credential(flow_server):
    """Carry 1's contract, kept across the rewrite: the flow surface declares no
    auth, and `SIGNATURE_FLOW_BASE` is env-configurable — so handing it a live
    session cookie would buy nothing and leak a credential to whatever that
    variable happens to resolve to.
    """
    seen = flow_server("\n".join(_csv_lines([
        {"CreatedDate": "7/3/2026", "CreatedTime": "09:31", "Symbol": "NVDA",
         "CallPut": "CALL", "Premium": "900000"}])) + "\n")

    by_date = sweep_mod._fetch_flow_by_date("NVDA")

    assert by_date == {"2026-07-03": [{"CreatedDate": "7/3/2026",
                                       "CallPut": "CALL", "Premium": "900000"}]}
    # `?source=stocks` is explicit, not inherited from the endpoint default:
    # the reader tries BOTH sources (index/ETF symbols are filed under
    # `indexes`), so which one produced these rows has to be on the wire.
    # Source-fallback behaviour itself lives in
    # `test_signature_flow_source_fallback.py`.
    assert seen["path"] == "/api/flow/ticker/NVDA?source=stocks"
    assert not {"cookie", "authorization"} & set(seen["headers"])


def test_the_real_flow_read_honours_the_window(flow_server):
    flow_server("\n".join(_csv_lines([
        {"CreatedDate": "7/3/2026", "CallPut": "CALL", "Premium": "9"},
        {"CreatedDate": "1/2/2026", "CallPut": "PUT", "Premium": "9"}])) + "\n")
    assert list(sweep_mod._fetch_flow_by_date("NVDA", "2026-07-01")) == ["2026-07-03"]


def test_a_non_200_flow_read_raises_rather_than_reporting_a_quiet_tape(flow_server):
    """An unreachable flow service and a genuinely quiet tape both produce zero
    signals, but only one of them is an answer."""
    flow_server("", status=500)
    with pytest.raises(Exception):
        sweep_mod._fetch_flow_by_date("NVDA")


# ── sweep_job: the scheduled entry ──────────────────────────────────────────

def _capture_run_sweep(monkeypatch):
    seen = {}

    def fake(symbols, **kw):
        seen["symbols"] = list(symbols)
        seen["kw"] = kw
        return {"symbols": 0, "scanned": 0, "recorded": 0, "errors": 0, "stale": 0}

    monkeypatch.setattr(sweep_mod, "run_sweep", fake)
    return seen


def test_sweep_job_defaults_to_the_ten_launch_symbols(monkeypatch):
    monkeypatch.delenv("SIGNATURE_SWEEP_SYMBOLS", raising=False)
    seen = _capture_run_sweep(monkeypatch)
    sweep_mod.sweep_job()
    assert seen["symbols"] == ["SPY", "QQQ", "NVDA", "TSLA", "AAPL",
                               "MSFT", "AMD", "META", "AMZN", "GOOGL"]


def test_sweep_job_reads_the_symbol_list_from_the_environment(monkeypatch):
    monkeypatch.setenv("SIGNATURE_SWEEP_SYMBOLS", " nvda , ,amd,  ")
    seen = _capture_run_sweep(monkeypatch)
    sweep_mod.sweep_job()
    assert seen["symbols"] == ["NVDA", "AMD"]


def test_sweep_job_wires_the_real_bars_reader(monkeypatch):
    from api.routers import signature as sig
    seen = _capture_run_sweep(monkeypatch)
    sweep_mod.sweep_job()
    assert seen["kw"]["fetch_bars"] is sig._fetch_bars


def test_sweep_jobs_flow_fetcher_passes_the_window_through(monkeypatch):
    calls = []
    monkeypatch.setattr(sweep_mod, "_fetch_flow_by_date",
                        lambda sym, cutoff_iso="": calls.append((sym, cutoff_iso)) or {})
    seen = _capture_run_sweep(monkeypatch)
    sweep_mod.sweep_job()

    assert seen["kw"]["fetch_flow"]("NVDA", "2026-06-01") == {}
    assert calls == [("NVDA", "2026-06-01")]


def test_the_window_handed_to_the_flow_fetcher_is_the_oldest_bar(tmp_ledger):
    """The cutoff has to come from the bars actually fetched, not a constant —
    a wrong window silently starves the join instead of failing."""
    bars = _bars_with_final_breakout()
    got = []
    run_sweep(["NVDA"], fetch_bars=lambda s: bars,
              fetch_flow=lambda s, c: got.append(c) or {}, now_iso="2026-08-03")
    assert got == [_bar_date_iso(bars[0]["t"])]


def test_a_failed_flow_read_is_an_error_not_an_empty_tape(monkeypatch, tmp_ledger):
    from api.routers import signature as sig
    bars = _bars_with_final_breakout()
    monkeypatch.setattr(sig, "_fetch_bars", lambda sym, count=60: bars)
    monkeypatch.setattr(sweep_mod, "_fetch_flow_by_date",
                        lambda sym, cutoff_iso="": (_ for _ in ()).throw(RuntimeError("down")))
    monkeypatch.setenv("SIGNATURE_SWEEP_SYMBOLS", "NVDA")

    seen, real = {}, sweep_mod.run_sweep
    monkeypatch.setattr(sweep_mod, "run_sweep",
                        lambda symbols, **kw: seen.setdefault("res", real(symbols, **kw)))
    sweep_mod.sweep_job()
    assert seen["res"] == {"symbols": 1, "scanned": 0, "recorded": 0,
                           "errors": 1, "stale": 0}


def test_sweep_job_never_raises_into_the_scheduler(monkeypatch, caplog):
    def boom(*a, **kw):
        raise RuntimeError("catastrophe")

    monkeypatch.setattr(sweep_mod, "run_sweep", boom)
    with caplog.at_level("ERROR", logger="signature.sweep"):
        sweep_mod.sweep_job()          # must not raise
    assert any(r.levelname == "ERROR" for r in caplog.records)


def test_the_sweep_date_is_the_ET_session_date_not_the_UTC_one(monkeypatch):
    """The pod runs UTC. A 20:05 ET job is already past midnight UTC in winter,
    so a bare `date.today()` stamps TOMORROW onto tonight's receipts.

    The clock is frozen (not read twice) so this cannot flake at midnight.
    """
    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            utc = datetime(2026, 8, 4, 1, 30, tzinfo=timezone.utc)
            return utc.astimezone(tz) if tz else utc.replace(tzinfo=None)

    monkeypatch.setattr(sweep_mod, "datetime", _Frozen)
    assert sweep_mod._sweep_date_iso() == "2026-08-03"
    assert sweep_mod._sweep_date_iso(
        datetime(2026, 8, 4, 1, 30, tzinfo=timezone.utc)) == "2026-08-03"


# ── scheduler registration ──────────────────────────────────────────────────

class _FakeSched:
    def __init__(self):
        self.jobs = []

    def add_job(self, func, *a, **kw):
        self.jobs.append((func, a, kw))


def _registered():
    import api.main as main
    sched = _FakeSched()
    assert main.register_signature_sweep_job(sched) is True
    assert len(sched.jobs) == 1
    return sched.jobs[0]


def test_the_sweep_job_is_registered_under_a_stable_id():
    func, _a, kw = _registered()
    assert kw["id"] == "signature_sweep"
    assert kw["replace_existing"] is True
    assert kw["max_instances"] == 1
    assert func is sweep_mod.sweep_job


def test_the_cron_fires_at_2005_ET_on_weekdays_in_both_halves_of_the_year():
    """Not `timezone=_ET` as a string in the source — the WALL CLOCK.

    A naive/UTC cron is the house trap (`lesson_apscheduler_cron_utc_trap`): it
    passes every structural check and then runs an hour off for half the year.

    20:05 sits after the house settle line — dark-pool ingest 19:20, side heal
    19:30, extended-hours drift to 20:00 — so the store's last daily bar has
    stopped moving by the time the freshness gate reads it.
    """
    _f, _a, kw = _registered()
    trig = kw["trigger"]

    summer = trig.get_next_fire_time(None, datetime(2026, 8, 3, 12, 0, tzinfo=_ET))
    assert (summer.year, summer.month, summer.day) == (2026, 8, 3)
    assert (summer.hour, summer.minute) == (20, 5)
    assert summer.tzinfo.key == "America/New_York"

    winter = trig.get_next_fire_time(None, datetime(2026, 1, 5, 12, 0, tzinfo=_ET))
    assert (winter.hour, winter.minute) == (20, 5)

    sat = trig.get_next_fire_time(None, datetime(2026, 8, 8, 12, 0, tzinfo=_ET))
    assert sat.weekday() == 0            # Monday, not Saturday or Sunday


def test_the_cron_lands_after_extended_hours_close():
    _f, _a, kw = _registered()
    fire = kw["trigger"].get_next_fire_time(None, datetime(2026, 8, 3, 12, 0, tzinfo=_ET))
    assert fire >= fire.replace(hour=20, minute=0)


def test_the_registration_runs_inside_the_scheduler_lock_block():
    """The registration function is unit-testable; the CALL SITE is not.

    So it is proven by parsing `api/main.py` and finding a real Call node inside
    the `if acquire_scheduler_lock():` guard — the only branch where a scheduler
    exists. A comment, a docstring mention, or a call sitting OUTSIDE that guard
    (where `_scheduler` is None and the job would never be added) all fail it,
    which neither a substring search nor a whole-function walk can claim.
    """
    import api.main as main
    tree = ast.parse(Path(main.__file__).read_text(encoding="utf-8"))
    lifespans = [n for n in ast.walk(tree)
                 if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))
                 and n.name == "lifespan"]
    assert lifespans, "api.main.lifespan not found — this test needs rewiring"

    guards = [n for n in ast.walk(lifespans[0])
              if isinstance(n, ast.If)
              and any(isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
                      and c.func.id == "acquire_scheduler_lock"
                      for c in ast.walk(n.test))]
    assert guards, "the acquire_scheduler_lock() guard was not found in lifespan"

    called = {n.func.id for g in guards for n in ast.walk(g)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "register_signature_sweep_job" in called
