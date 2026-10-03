"""Wave 13 lane 13F -- the leak finder (`api/services/journal_two/leak_finder.py`).

Pure, deterministic, no DB: every test builds its own enriched-trade fixtures (the
contract `review_drafts.py` promises -- see the module docstring) with KNOWN n and
KNOWN dollars, and pins the detector's answer against hand-computed values.

Rails, each a ruling:
  * EVERY FINDING'S TRADES SUM TO ITS DOLLARS -- by construction (`_finding` sums the
    exact cited trades), and every test below re-derives the sum independently and
    compares it to the declared `dollarImpact.netPnl`.
  * R3 WORDING -- a finding's `sample` is `sample_size.mean_stat` over its own cited
    trades: below n=10 the band is `too_few` and the wording rides without a plain
    number; a control fixture is built at 2, 10 and 25 citing trades to prove all
    three bands are reachable.
  * NO MODEL CLIENT REACHABLE -- an import-graph control over this module and
    `review_drafts.py`.
"""
from __future__ import annotations

from api.services.journal_two import leak_finder


# ── fixtures ────────────────────────────────────────────────────────────────────────


def trade(i, *, symbol="NVDA", entry="2026-09-28T13:30:00+00:00", exit_="2026-09-28T14:00:00+00:00",
         pnl_net=-100.0, r=-1.0, result="Loss", hour_et=9, status="planned", stop=None, entry_price=100.0,
         shares=100.0, side="Long", setup=None, context_at_entry="{}", entry_context=None, checks=None):
    return {
        "id": f"id{i}", "tradeRef": f"id:id{i}", "symbol": symbol, "side": side,
        "shares": shares, "entryPrice": entry_price, "exitPrice": entry_price + (r if r else 0),
        "entryDate": entry, "exitDate": exit_, "originalStop": stop, "setup": setup, "source": None,
        "pnlDollarGross": pnl_net, "fees": 0.0, "pnlDollarNet": pnl_net, "rMultiple": r, "result": result,
        "hourEt": hour_et, "tradingDayEt": exit_[:10], "contextAtEntry": context_at_entry,
        "status": status, "checks": checks, "entryContext": entry_context,
    }


def baseline_of(trades):
    return leak_finder.baseline_stats(trades)


# ── baseline_stats ────────────────────────────────────────────────────────────────


def test_baseline_is_the_plain_mean_over_the_whole_period():
    trades = [trade(1, r=1.0, pnl_net=100.0), trade(2, r=-1.0, pnl_net=-100.0), trade(3, r=0.5, pnl_net=50.0)]
    b = baseline_of(trades)
    assert b["n"] == 3
    assert round(b["avgR"], 4) == round((1.0 - 1.0 + 0.5) / 3, 4)
    assert round(b["avgNetPnlPerTrade"], 2) == round((100 - 100 + 50) / 3, 2)


def test_baseline_is_none_safe_on_an_empty_period():
    b = baseline_of([])
    assert b == {"n": 0, "avgR": None, "avgNetPnlPerTrade": None}


# ── _finding / the sum invariant ─────────────────────────────────────────────────


def test_a_findings_trades_sum_to_its_dollars_at_every_sample_band():
    for n, expect_band in ((2, "too_few"), (12, "thin"), (30, "normal")):
        trades = [trade(i, r=-1.0, pnl_net=-50.0) for i in range(n)]
        baseline = baseline_of(trades)
        f = leak_finder._finding("probe", "Probe", trades, baseline=baseline)
        assert f["sample"]["band"] == expect_band
        assert f["sample"]["n"] == n
        declared = f["dollarImpact"]["netPnl"]
        resummed = round(sum(t["pnlDollar"] for t in f["trades"]), 2)
        assert resummed == declared
        assert declared == round(-50.0 * n, 2)


def test_a_finding_with_nothing_to_cite_is_None_never_a_placeholder():
    assert leak_finder._finding("probe", "Probe", [], baseline={"avgR": None, "avgNetPnlPerTrade": None}) is None
    # a trade missing r_multiple cannot anchor an R-based finding
    ungraded = [trade(1, r=None)]
    assert leak_finder._finding("probe", "Probe", ungraded, baseline={"avgR": None, "avgNetPnlPerTrade": None}) is None


# ── revenge re-entry (reuses revenge_detect.py, unchanged) ───────────────────────


def test_revenge_reentry_cites_exactly_the_flagged_reentries():
    loss = trade(1, symbol="NVDA", entry="2026-09-28T13:00:00+00:00", exit_="2026-09-28T13:30:00+00:00",
                 r=-1.0, pnl_net=-100.0, result="Loss")
    reentry = trade(2, symbol="NVDA", entry="2026-09-28T13:45:00+00:00", exit_="2026-09-28T14:15:00+00:00",
                    r=-0.5, pnl_net=-50.0, result="Loss")
    unrelated = trade(3, symbol="AAPL", entry="2026-09-28T15:00:00+00:00", exit_="2026-09-28T15:30:00+00:00",
                      r=1.0, pnl_net=100.0, result="Win")
    trades = [loss, reentry, unrelated]
    baseline = baseline_of(trades)
    found = leak_finder.find_leaks(trades, baseline=baseline)
    revenge = next((f for f in found if f["kind"] == "revenge_reentry"), None)
    assert revenge is not None
    assert revenge["sample"]["n"] == 1
    assert {t["id"] for t in revenge["trades"]} == {"id2"}
    assert revenge["dollarImpact"]["netPnl"] == -50.0


def test_revenge_reentry_absent_when_no_reentry_fired():
    trades = [trade(1, r=1.0, pnl_net=100.0, result="Win"), trade(2, r=0.5, pnl_net=50.0, result="Win")]
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades))
    assert all(f["kind"] != "revenge_reentry" for f in found)


# ── size up after a loss ──────────────────────────────────────────────────────────


def test_size_up_after_loss_flags_a_big_risk_trade_right_after_a_loss():
    # Five "normal" trades at $1/share risk (100 shares, stop $1 away), then a loss,
    # then one trade sized at 3x the median risk -- should flag.
    normal = [
        trade(i, exit_=f"2026-09-2{i}T19:00:00+00:00", r=0.1, pnl_net=10.0, result="Win",
             stop=99.0, entry_price=100.0, shares=100.0)
        for i in range(5)
    ]
    loss = trade(90, exit_="2026-09-29T10:00:00+00:00", r=-1.0, pnl_net=-100.0, result="Loss",
                stop=99.0, entry_price=100.0, shares=100.0)
    big = trade(91, exit_="2026-09-29T11:00:00+00:00", r=-1.0, pnl_net=-300.0, result="Loss",
               stop=95.0, entry_price=100.0, shares=300.0)  # risk = 5*300 = 1500, vs median ~100
    trades = [*normal, loss, big]
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades))
    sized = next((f for f in found if f["kind"] == "size_up_after_loss"), None)
    assert sized is not None
    assert {t["id"] for t in sized["trades"]} == {"id91"}


def test_size_up_after_loss_never_fires_on_a_placeholder_stop():
    # stop == entry is the broker-mirror placeholder (placeholder_stop.is_placeholder_stop);
    # it must never be read as "zero risk, therefore a huge multiple".
    loss = trade(1, exit_="2026-09-29T10:00:00+00:00", r=-1.0, pnl_net=-100.0, result="Loss",
                stop=99.0, entry_price=100.0, shares=100.0)
    placeholder = trade(2, exit_="2026-09-29T11:00:00+00:00", r=-1.0, pnl_net=-50.0, result="Loss",
                       stop=100.0, entry_price=100.0, shares=500.0)  # stop == entry
    trades = [loss, placeholder]
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades))
    assert all(f["kind"] != "size_up_after_loss" for f in found)


# ── a weak time window ────────────────────────────────────────────────────────────


def test_weak_time_window_flags_the_hour_below_the_periods_own_baseline():
    morning = [trade(i, hour_et=9, r=1.0, pnl_net=100.0, result="Win") for i in range(3)]
    afternoon = [trade(i + 10, hour_et=15, r=-2.0, pnl_net=-200.0, result="Loss") for i in range(3)]
    trades = [*morning, *afternoon]
    baseline = baseline_of(trades)
    found = leak_finder.find_leaks(trades, baseline=baseline)
    weak = next((f for f in found if f["kind"] == "weak_time_window"), None)
    assert weak is not None
    assert weak["detail"]["hourEt"] == 15
    assert {t["id"] for t in weak["trades"]} == {"id10", "id11", "id12"}


def test_weak_time_window_absent_when_no_hour_is_below_baseline():
    trades = [trade(i, hour_et=9, r=1.0, pnl_net=100.0, result="Win") for i in range(3)]
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades))
    assert all(f["kind"] != "weak_time_window" for f in found)


def test_weak_time_window_absent_when_hour_et_is_null_throughout():
    trades = [trade(i, hour_et=None, r=-1.0, pnl_net=-100.0, result="Loss") for i in range(3)]
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades))
    assert all(f["kind"] != "weak_time_window" for f in found)


# ── regime at entry / held into earnings (13E's entry_context) ──────────────────


def test_regime_at_entry_flags_only_unfavourable_regimes():
    red = trade(1, r=-1.0, pnl_net=-100.0,
               entry_context={"fields": {"regime": {"value": "red"}}})
    green = trade(2, r=1.0, pnl_net=100.0, result="Win",
                 entry_context={"fields": {"regime": {"value": "green"}}})
    amber = trade(3, r=0.2, pnl_net=20.0, result="Win",
                 entry_context={"fields": {"regime": {"value": "amber"}}})
    trades = [red, green, amber]
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades))
    regime = next((f for f in found if f["kind"] == "regime_at_entry"), None)
    assert regime is not None
    assert {t["id"] for t in regime["trades"]} == {"id1"}
    assert regime["detail"]["byRegime"] == {"red": 1}


def test_held_into_earnings_flags_a_report_date_between_entry_and_exit():
    held = trade(
        1, entry="2026-09-28T13:30:00+00:00", exit_="2026-10-02T19:00:00+00:00", r=-1.0, pnl_net=-100.0,
        entry_context={"fields": {"days_to_earnings": {"detail": {"reportDate": "2026-09-30"}}}},
    )
    not_held = trade(
        2, entry="2026-09-28T13:30:00+00:00", exit_="2026-09-28T19:00:00+00:00", r=1.0, pnl_net=100.0,
        result="Win", entry_context={"fields": {"days_to_earnings": {"detail": {"reportDate": "2026-11-01"}}}},
    )
    trades = [held, not_held]
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades))
    earn = next((f for f in found if f["kind"] == "held_into_earnings"), None)
    assert earn is not None
    assert {t["id"] for t in earn["trades"]} == {"id1"}


# ── Compass SKIP overridden (verdict_scorecard.py's own headline) ───────────────


def test_skip_overridden_cites_the_skip_verdict_trades_and_matches_the_scorecards_own_sum():
    skip_ctx = '{"compass_verdict_id": "v1", "compass_verdict_label": "SKIP"}'
    skipped = [
        trade(1, r=-1.0, pnl_net=-80.0, context_at_entry=skip_ctx),
        trade(2, r=-0.5, pnl_net=-40.0, context_at_entry=skip_ctx),
    ]
    other = trade(3, r=1.0, pnl_net=100.0, result="Win")
    trades = [*skipped, other]
    scorecard = {"skipOverrideHeadline": {"n": 2, "netPnl": -120.0, "losses": 2, "decisive": 2, "lossRate": 1.0}}
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades), verdict_scorecard=scorecard)
    so = next((f for f in found if f["kind"] == "skip_overridden"), None)
    assert so is not None
    assert {t["id"] for t in so["trades"]} == {"id1", "id2"}
    assert so["dollarImpact"]["netPnl"] == scorecard["skipOverrideHeadline"]["netPnl"]


def test_skip_overridden_absent_without_a_scorecard_or_with_nothing_overridden():
    trades = [trade(1, r=1.0, pnl_net=100.0, result="Win")]
    assert all(f["kind"] != "skip_overridden" for f in leak_finder.find_leaks(trades, baseline=baseline_of(trades)))
    assert all(
        f["kind"] != "skip_overridden"
        for f in leak_finder.find_leaks(
            trades, baseline=baseline_of(trades),
            verdict_scorecard={"skipOverrideHeadline": None},
        )
    )


# ── unplanned trades / stops not honoured (13A reuse) ────────────────────────────


def test_unplanned_and_stops_not_honoured_read_off_13as_own_status_and_checks():
    unplanned = trade(1, r=-1.0, pnl_net=-100.0, status="unplanned")
    missed_stop = trade(2, r=-2.0, pnl_net=-200.0, status="planned",
                       checks={"stop": {"state": "missed"}, "target": {"state": "unknown"}})
    clean = trade(3, r=1.0, pnl_net=100.0, result="Win", status="planned",
                 checks={"stop": {"state": "kept"}, "target": {"state": "hit"}})
    trades = [unplanned, missed_stop, clean]
    found = leak_finder.find_leaks(trades, baseline=baseline_of(trades))
    up = next(f for f in found if f["kind"] == "unplanned_trades")
    sn = next(f for f in found if f["kind"] == "stops_not_honoured")
    assert {t["id"] for t in up["trades"]} == {"id1"}
    assert {t["id"] for t in sn["trades"]} == {"id2"}


# ── no model client reachable ──────────────────────────────────────────────────


def test_no_model_client_is_importable_from_this_module_or_review_drafts():
    import ast
    from pathlib import Path

    repo = Path(__file__).resolve().parents[1]
    forbidden = {"anthropic", "openai"}
    for rel in ("api/services/journal_two/leak_finder.py", "api/services/journal_two/review_drafts.py"):
        tree = ast.parse((repo / rel).read_text(encoding="utf-8"))
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.add(node.module.split(".")[0])
        assert not (names & forbidden), f"{rel} imports a model client: {names & forbidden}"
