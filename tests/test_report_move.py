"""`implied_move.report_move`: one bounded straddle read for the callers that know
a report, not a chain (the earnings preview/analysis enrichment, the Discord chart
context line, the earnings-reaction panel, the Notebook reporting widgets).

What is pinned here:
  A. SHAPE -- the field names and rounding those callers already read, plus where
     the number came from (`source`) and when the chain was read (`asof`).
  B. HONEST EMPTY -- no answer is None with a typed reason; never 0, never a raise.
  C. BOUNDED -- a held straddle answers on the caller's thread with no build; a
     cold one is built on the module's pool, the caller waits no longer than its
     timeout, the build still lands, and a list of names never runs more builds
     at once than the pool has workers.
  D. THE CALLERS -- each one reads `report_move`, and none reads the delayed
     straddle in `earnings_enrichment` any more. The Calendar's default path is
     the one reader left on it (see tests/test_calendar_enrichment.py).
  E. ONE WORKED EXAMPLE of how the two computations differ on the same quotes.

No network: every chain read is a stub, and `earnings_enrichment.get_implied_move`
is replaced by a function that fails the test if anything here reaches it.
"""
from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from api.services import earnings_enrichment as ee
from api.services import implied_move as im

SYM = "RPTM"
REPORT = "2026-08-12"
EXPIRY = "2026-08-14"
KEY = f"expmove::{SYM}::{REPORT}"

# The same quotes tests/test_earnings_enrichment_spot_source.py uses, restated:
#   call mid (4.00 + 4.46) / 2 = 4.23, put mid (2.80 + 3.20) / 2 = 3.00
#   straddle 7.23 on a 100.00 spot = 7.23% -> 7.2 at 1dp
_QUOTES = {
    "calls": [(95.0, 7.00, 7.40, 7.20), (100.0, 4.00, 4.46, 4.20), (105.0, 2.00, 2.20, 2.10)],
    "puts":  [(95.0, 1.00, 1.20, 1.10), (100.0, 2.80, 3.20, 3.00), (105.0, 6.00, 6.40, 6.20)],
}
SHARED_FIELDS = {"pct": 7.2, "dollar": 7.23, "expiry": EXPIRY, "strike": 100.0,
                 "spot": 100.0, "call_mark": 4.23, "put_mark": 3.0}


def _chain(quotes=_QUOTES, spot=100.0):
    def rows(side):
        return [{"strike": k, "bid": b, "ask": a, "iv": 0.5, "expiration": EXPIRY}
                for k, b, a, _last in quotes[side]]
    return {"ticker": SYM, "expiration": EXPIRY, "spot": spot,
            "calls": rows("calls"), "puts": rows("puts")}


def _move(pct=7.2345, dollar=7.2345):
    """What `get_expected_move` hands back: UNROUNDED, with its own field names."""
    return {"pct": pct, "dollar": dollar, "strike": 100.0, "spot": 100.004,
            "call_mid": 4.2349, "put_mid": 2.9996, "iv_atm": 0.5, "expiry": EXPIRY,
            "horizon": f"through {EXPIRY}", "asof": "2026-08-11T15:30:00+00:00",
            "source": "massive-chain"}


def _forget(*syms_dates_timing):
    im._MOVE_CACHE.clear()
    for key in syms_dates_timing:
        im._MOVE_STALE.forget(key)
    with im._report_lock:
        im._report_inflight.clear()


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    _forget(KEY, KEY + "::amc")
    # Nothing in this file may reach the delayed straddle (or the network behind it).
    monkeypatch.setattr(ee, "get_implied_move",
                        lambda *a, **k: pytest.fail("a report caller read earnings_enrichment.get_implied_move"))
    yield
    _forget(KEY, KEY + "::amc")


def _stub_chain(monkeypatch, chain=None, expirations=(EXPIRY,)):
    """Stub the two chain reads and count them."""
    calls = {"expirations": 0, "chain": 0}

    def list_expirations(sym):
        calls["expirations"] += 1
        return {"expirations": list(expirations)}

    def get_chain(sym, expiration=None, strikes_around_spot=None):
        calls["chain"] += 1
        return chain if chain is not None else _chain()

    monkeypatch.setattr(im.polygon_options, "list_expirations", list_expirations)
    monkeypatch.setattr(im.polygon_options, "get_chain", get_chain)
    return calls


# ── A. shape ──────────────────────────────────────────────────────────────────

def test_the_shape_is_the_one_the_report_callers_read(monkeypatch):
    monkeypatch.setattr(im, "get_expected_move", lambda *a, **k: _move())
    out = im.report_move(SYM, REPORT)
    assert out == {"pct": 7.2, "dollar": 7.23, "expiry": EXPIRY, "strike": 100.0, "spot": 100.0,
                   "call_mark": 4.23, "put_mark": 3.0, "horizon": f"through {EXPIRY}",
                   "asof": "2026-08-11T15:30:00+00:00", "source": "massive-chain"}
    # the old field names are the contract; the new source's own names do not leak
    assert "call_mid" not in out and "put_mid" not in out and "iv_atm" not in out


def test_pct_is_one_decimal_and_the_dollar_figures_two(monkeypatch):
    """Readers print `pct` with no formatter. 7.26 separates 1dp from 2dp and from
    truncation (7.3, not 7.26 and not 7.2)."""
    monkeypatch.setattr(im, "get_expected_move", lambda *a, **k: _move(pct=7.26, dollar=7.266))
    out = im.report_move(SYM, REPORT)
    assert out["pct"] == 7.3 and out["dollar"] == 7.27


def test_same_quotes_give_the_same_seven_fields_as_the_delayed_straddle(monkeypatch):
    """End to end over the real straddle maths, with only the two chain reads stubbed."""
    _stub_chain(monkeypatch)
    out = im.report_move(SYM, REPORT)
    assert {k: out[k] for k in SHARED_FIELDS} == SHARED_FIELDS
    assert out["source"] == "massive-chain" and out["horizon"] == f"through {EXPIRY}" and out["asof"]


# ── B. honest empty ───────────────────────────────────────────────────────────

def test_a_refusal_is_none_with_its_reason_and_never_a_zero(monkeypatch):
    def refused(sym, report_date=None, *, outcome=None, timing=None):
        outcome.update({"ok": False, "kind": im.KIND_REFUSED, "reason": im.REFUSED_NO_ATM_STRIKE})
        return None
    monkeypatch.setattr(im, "get_expected_move", refused)
    why: dict = {}
    assert im.report_move(SYM, REPORT, outcome=why) is None
    assert why == {"ok": False, "kind": "refused", "reason": "no_atm_strike"}


def test_a_report_beyond_every_listed_expiry_is_none_not_the_front_expiry(monkeypatch):
    """The delayed straddle fell back to the front expiry here; this read says it has no answer."""
    calls = _stub_chain(monkeypatch, expirations=("2026-08-07",))
    why: dict = {}
    assert im.report_move(SYM, REPORT, outcome=why) is None
    assert why["kind"] == "unavailable" and why["reason"] == im.UNAVAILABLE_NO_EXPIRY
    assert calls["chain"] == 0


def test_a_read_that_raises_is_none_with_read_error(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("chain read blew up")
    monkeypatch.setattr(im, "get_expected_move", boom)
    why: dict = {}
    assert im.report_move(SYM, REPORT, outcome=why) is None
    assert why == {"ok": False, "kind": "unavailable", "reason": im.UNAVAILABLE_READ_ERROR}


def test_a_malformed_straddle_is_none_not_a_partial_dict(monkeypatch):
    bad = _move()
    bad["call_mid"] = None
    monkeypatch.setattr(im, "get_expected_move", lambda *a, **k: bad)
    why: dict = {}
    assert im.report_move(SYM, REPORT, outcome=why) is None
    assert why["ok"] is False and why["reason"] == im.UNAVAILABLE_READ_ERROR


def test_no_symbol_is_none_without_a_read(monkeypatch):
    monkeypatch.setattr(im, "get_expected_move", lambda *a, **k: pytest.fail("nothing to ask for"))
    assert im.report_move("", REPORT) is None and im.report_move(None, REPORT) is None


# ── C. bounded ────────────────────────────────────────────────────────────────

def test_a_cold_read_is_built_on_the_modules_pool_and_a_held_one_on_the_callers_thread(monkeypatch):
    calls = _stub_chain(monkeypatch)
    ran_on = []
    real = im.compute_expected_move

    def spy(*a, **k):
        ran_on.append(threading.current_thread().name)
        return real(*a, **k)
    monkeypatch.setattr(im, "compute_expected_move", spy)

    assert im.report_move(SYM, REPORT)["pct"] == 7.2
    assert len(ran_on) == 1 and ran_on[0].startswith("report-move")
    assert calls == {"expirations": 1, "chain": 1}

    # held now: the next ask builds nothing and never touches the pool
    monkeypatch.setattr(im._REPORT_POOL, "submit", lambda *a, **k: pytest.fail("a held straddle must not use the pool"))
    assert im.report_move(SYM, REPORT)["pct"] == 7.2
    assert calls == {"expirations": 1, "chain": 1} and len(ran_on) == 1


def test_many_asks_for_one_report_cost_one_chain_read(monkeypatch):
    """The budget rule: four different callers asking about the same report inside
    the cache window are ONE expirations read and ONE chain read between them."""
    from api.services import discord_chart_context as dcc
    from api.services import earnings_reaction_panel as panel
    from api.services.journal_two import notebook_widgets as nw
    calls = _stub_chain(monkeypatch)
    monkeypatch.setattr(im, "report_timing", lambda s, d: None)
    panel._implied.pop(SYM, None)

    assert ee._implied_for_report(SYM, REPORT, None)["pct"] == 7.2
    assert dcc._implied(SYM, REPORT)["pct"] == 7.2
    panel._read_implied(SYM, REPORT)
    assert panel._implied.pop(SYM)[1]["pct"] == 7.2
    assert nw._implied_move_pct(SYM, REPORT, None) == 7.2
    assert calls == {"expirations": 1, "chain": 1}


def test_a_slow_build_frees_the_caller_at_its_timeout_and_still_lands(monkeypatch):
    gate, started = threading.Event(), threading.Event()
    builds = []

    def slow(sym, report_date=None, *, outcome=None, timing=None):
        builds.append(sym)
        started.set()
        gate.wait(5)
        im._MOVE_CACHE.set(KEY, _move(), 60)       # what a real build does on success
        return _move()
    monkeypatch.setattr(im, "get_expected_move", slow)

    why: dict = {}
    t0 = time.monotonic()
    assert im.report_move(SYM, REPORT, outcome=why, timeout=0.2) is None
    assert time.monotonic() - t0 < 2.0
    assert why == {"ok": False, "kind": "unavailable", "reason": im.UNAVAILABLE_TIMEOUT}
    assert started.is_set()

    # a second asker while the first build runs waits on THAT build, not a new one
    assert im.report_move(SYM, REPORT, timeout=0.1) is None
    assert builds == [SYM]

    gate.set()
    im._REPORT_POOL.submit(lambda: None).result(5)
    deadline = time.monotonic() + 5
    while KEY in im._report_inflight and time.monotonic() < deadline:
        time.sleep(0.01)
    assert KEY not in im._report_inflight
    # the abandoned build landed, so the next ask is a held answer
    monkeypatch.setattr(im, "get_expected_move", lambda *a, **k: dict(im._MOVE_CACHE.get(KEY)))
    assert im.report_move(SYM, REPORT, timeout=0.1)["pct"] == 7.2


def test_a_list_of_names_never_runs_more_builds_at_once_than_the_pool_has_workers(monkeypatch):
    live, peak, lock = [0], [0], threading.Lock()

    def build(sym, report_date=None, *, outcome=None, timing=None):
        with lock:
            live[0] += 1
            peak[0] = max(peak[0], live[0])
        time.sleep(0.05)
        with lock:
            live[0] -= 1
        return _move()
    monkeypatch.setattr(im, "get_expected_move", build)
    names = [f"L{i:02d}" for i in range(12)]
    out: dict = {}
    threads = [threading.Thread(target=lambda s=s: out.__setitem__(s, im.report_move(s, REPORT, timeout=10)))
               for s in names]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert all(out[s]["pct"] == 7.2 for s in names)
    assert 1 <= peak[0] <= im.REPORT_POOL_WORKERS == 4


def test_a_full_pool_answers_at_once_instead_of_queueing(monkeypatch):
    monkeypatch.setattr(im, "get_expected_move", lambda *a, **k: pytest.fail("a full pool must not start a build"))
    with im._report_lock:
        for i in range(im.REPORT_MAX_PENDING):
            im._report_inflight[f"busy::{i}"] = (None, {})
    why: dict = {}
    t0 = time.monotonic()
    assert im.report_move(SYM, REPORT, outcome=why, timeout=5) is None
    assert time.monotonic() - t0 < 1.0
    assert why["kind"] == "unavailable" and why["reason"] == im.UNAVAILABLE_TIMEOUT


def test_an_after_close_report_is_its_own_entry_and_carries_its_session(monkeypatch):
    seen = []

    def build(sym, report_date=None, *, outcome=None, timing=None):
        seen.append((sym, report_date, timing))
        return _move()
    monkeypatch.setattr(im, "get_expected_move", build)
    im.report_move("rptm", REPORT, timing="AMC")
    assert seen == [(SYM, REPORT, "AMC")]
    assert im._move_key(SYM, REPORT, "AMC") == KEY + "::amc" and im._move_key(SYM, REPORT, "bmo") == KEY
    assert im._move_key("rptm", None) == f"expmove::{SYM}::"


# ── D. the callers ────────────────────────────────────────────────────────────

def _recording(calls, result):
    def fake(sym, report_date=None, *, timing=None, outcome=None, timeout=None):
        calls.append({"sym": sym, "date": report_date, "timing": timing, "timeout": timeout})
        if outcome is not None and result is None:
            outcome.update({"ok": False, "kind": "refused", "reason": "no_quoted_straddle"})
        return dict(result) if result else None
    return fake


def test_the_enrichment_fan_out_reads_report_move_and_keeps_all_six_legs(monkeypatch):
    for name in ("get_pre_earnings_context", "get_estimate_revisions", "get_key_quotes",
                 "get_historical_earnings_moves", "extract_beat_surprises"):
        monkeypatch.setattr(ee, name, lambda *a, **k: None)
    calls = []
    monkeypatch.setattr(im, "report_move", _recording(calls, im.report_shape(_move())))
    out = ee.enrich_earnings_response(SYM, [], REPORT, timing="amc")
    assert set(out) == {"pre_earnings", "hist_moves", "revisions", "beat_surprises", "implied_move", "key_quotes"}
    assert out["implied_move"]["pct"] == 7.2 and out["implied_move"]["source"] == "massive-chain"
    assert [(c["sym"], c["date"], c["timing"]) for c in calls] == [(SYM, REPORT, "amc")]

    monkeypatch.setattr(im, "report_move", _recording(calls, None))
    out = ee.enrich_earnings_response(SYM, [], REPORT, timing="amc")
    assert "implied_move" in out and out["implied_move"] is None


def test_the_discord_line_reads_report_move_and_drops_the_part_when_there_is_none(monkeypatch):
    import datetime as dt
    from api.services import discord_chart_context as dcc
    calls = []
    monkeypatch.setattr(im, "report_timing", lambda s, d: "amc")
    monkeypatch.setattr(im, "report_move", _recording(calls, im.report_shape(_move())))
    today = dt.date(2026, 8, 10)
    earn = lambda t, d: {"report_date": REPORT}          # noqa: E731
    dcc.clear_for_tests()
    line = dcc.context_line("RPTA", today=today, earnings_fn=earn, implied_fn=dcc._implied, catalyst_fn=lambda t, d: None)
    assert "±7.2% implied" in line
    assert [(c["sym"], c["date"], c["timing"]) for c in calls] == [("RPTA", REPORT, "amc")]

    monkeypatch.setattr(im, "report_move", _recording(calls, None))
    line = dcc.context_line("RPTB", today=today, earnings_fn=earn, implied_fn=dcc._implied, catalyst_fn=lambda t, d: None)
    assert "implied" not in line and "Earnings" in line and "0.0" not in line


def test_the_reaction_panel_reads_report_move_names_its_source_and_dates_the_read(monkeypatch):
    from api.services import earnings_reaction_panel as panel
    calls = []
    monkeypatch.setattr(im, "report_timing", lambda s, d: None)
    monkeypatch.setattr(im, "report_move", _recording(calls, im.report_shape(_move())))
    panel._implied.pop(SYM, None)
    panel._read_implied(SYM, REPORT)
    assert calls and calls[0]["timeout"] == panel._IMPLIED_READ_TIMEOUT_S
    snap = panel.implied_snapshot(SYM, REPORT)
    panel._implied.pop(SYM, None)
    # every field the panel's sentence prints
    assert snap["state"] == "ok" and (snap["pct"], snap["dollar"], snap["expiry"], snap["strike"]) == (7.2, 7.23, EXPIRY, 100.0)
    assert (snap["call_mark"], snap["put_mark"]) == (4.23, 3.0) and snap["source"] == "massive-chain"
    # "read <time>" is when the CHAIN was read (2026-08-11T15:30:00Z), not when the worker ran
    assert snap["read_at"] == 1786462200.0
    assert "implied_move.report_move" in panel.SOURCE and "our own option chain read" in panel.SOURCE
    assert "earnings_enrichment" not in panel.SOURCE and "get_implied_move" not in panel.SOURCE


@pytest.mark.parametrize("kind,reason,words", [
    ("refused", "no_atm_strike", "no quoted at-the-money straddle we can stand behind"),
    ("unavailable", "chain_timeout", "could not be read"),
])
def test_the_reaction_panel_says_why_there_is_no_number(monkeypatch, kind, reason, words):
    from api.services import earnings_reaction_panel as panel

    def none_with_reason(sym, report_date=None, *, timing=None, outcome=None, timeout=None):
        outcome.update({"ok": False, "kind": kind, "reason": reason})
        return None
    monkeypatch.setattr(im, "report_timing", lambda s, d: None)
    monkeypatch.setattr(im, "report_move", none_with_reason)
    panel._implied.pop("RPTN", None)
    panel._read_implied("RPTN", REPORT)
    snap = panel.implied_snapshot("RPTN", REPORT)
    panel._implied.pop("RPTN", None)
    panel._implied_why.pop("RPTN", None)
    assert snap["state"] == "unavailable" and words in snap["reason"] and "option chain" in snap["reason"]
    assert "pct" not in snap


def test_the_notebook_cell_reads_report_move_inside_the_widgets_budget(monkeypatch):
    from api.services.journal_two import notebook_widgets as nw
    calls = []
    monkeypatch.setattr(im, "report_move", _recording(calls, im.report_shape(_move())))
    assert nw._implied_move_pct(SYM, REPORT, "amc") == 7.2
    assert calls == [{"sym": SYM, "date": REPORT, "timing": "amc", "timeout": nw.IMPLIED_MOVE_BUDGET_S}]
    monkeypatch.setattr(im, "report_move", _recording(calls, None))
    assert nw._implied_move_pct(SYM, REPORT, "amc") is None


def test_a_slow_chain_releases_the_notebook_worker_at_the_budget(monkeypatch):
    """The widget pool's worker must come back at the budget, not when the chain does."""
    from api.services.journal_two import notebook_widgets as nw
    gate = threading.Event()

    def slow(sym, report_date=None, *, outcome=None, timing=None):
        gate.wait(5)
        return _move()
    monkeypatch.setattr(im, "get_expected_move", slow)
    monkeypatch.setattr(nw, "IMPLIED_MOVE_BUDGET_S", 0.2)
    t0 = time.monotonic()
    try:
        assert nw._implied_move_pct(SYM, REPORT, None) is None
        assert time.monotonic() - t0 < 2.0
    finally:
        gate.set()
        im._REPORT_POOL.submit(lambda: None).result(5)


# ── E. one worked example of how the two computations differ ──────────────────

def test_worked_example_a_one_sided_call_quote_reads_differently_in_the_two_sources(monkeypatch):
    """Same strikes and the same spot (100.00). The at-the-money call has NO BID
    (0.00) under a 4.46 ask, and last traded at 4.20; the put is 2.80 x 3.20.

      delayed straddle (earnings_enrichment.get_implied_move): a mark with no bid
        falls back to the LAST TRADE -> 4.20 + 3.00 = 7.20 -> 7.2%
      this read (bid/ask midpoint only, no last-trade fallback):
        (0.00 + 4.46) / 2 = 2.23 -> 2.23 + 3.00 = 5.23 -> 5.2%

    With two-sided quotes the two agree to the last printed digit (the parity
    test above); they part only where a quote is one-sided or missing."""
    quotes = {"calls": [(95.0, 7.00, 7.40, 7.20), (100.0, 0.00, 4.46, 4.20), (105.0, 2.00, 2.20, 2.10)],
              "puts": _QUOTES["puts"]}
    _stub_chain(monkeypatch, chain=_chain(quotes))
    new = im.report_move(SYM, REPORT)
    assert (new["pct"], new["dollar"], new["call_mark"], new["put_mark"]) == (5.2, 5.23, 2.23, 3.0)

    monkeypatch.undo()                      # the delayed straddle itself, on a stubbed vendor object

    def frame(side):
        rows = quotes[side]
        return pd.DataFrame({"strike": [r[0] for r in rows], "bid": [r[1] for r in rows],
                             "ask": [r[2] for r in rows], "lastPrice": [r[3] for r in rows]})
    chain = MagicMock()
    chain.calls, chain.puts = frame("calls"), frame("puts")
    chain.underlying = {"regularMarketPrice": 100.0}
    ticker = MagicMock()
    ticker.options = [EXPIRY]
    ticker.option_chain.return_value = chain
    ticker.history.side_effect = AssertionError("no price-history read on this path")
    with patch("yfinance.Ticker", return_value=ticker):
        old = ee.get_implied_move(SYM, earnings_date=REPORT)
    assert (old["pct"], old["dollar"], old["call_mark"], old["put_mark"]) == (7.2, 7.2, 4.2, 3.0)
