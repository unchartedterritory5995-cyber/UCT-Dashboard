"""Journal 2.0 — the leak finder (wave 13, lane 13F).

Pure, deterministic, side-effect-free: no DB, no clock, no model. Every detector takes the
SAME enriched trade list `review_drafts.py` assembles (one DB-touching caller, several pure
readers — the same shape as `revenge_detect.py` and `playbook_patterns.py`) and returns a
finding or ``None``. Nothing here recomputes a statistic another module already owns:

  * the revenge signal is `revenge_detect.detect` (Journal A+ P5), unchanged;
  * the plan-vs-execution status/checks are 13A's `plan_grading.grade_payload`, read off the
    trade dict review_drafts.py already computed;
  * the regime-at-entry and held-into-earnings fields are 13E's `entry_context`, read off the
    trade dict's ``entryContext``;
  * the SKIP-overridden dollar story is 13's own `verdict_scorecard.get_verdict_scorecard`
    headline — this module only re-derives WHICH trades belong to that bucket (a plain
    membership test, not a statistic) via `verdict_scorecard.verdict_label_from_context`, the
    same parse the scorecard itself uses, so the two can never disagree about who is in it.

**The contract** — every item of `trades` carries (built once by `review_drafts.py`):

    id, tradeRef, symbol, side, shares, entryPrice, exitPrice, entryDate, exitDate,
    originalStop, setup, source, pnlDollarGross, fees, pnlDollarNet, rMultiple, result,
    hourEt, tradingDayEt, contextAtEntry (the raw stored TEXT), status (plan_grading's
    match status), checks (plan_grading.grade_checks' output, or None), entryContext (13E's
    context dict, or None).

**R3 wording.** Every finding's ``sample`` is `sample_size.mean_stat` over the cited trades'
``rMultiple`` — the one home for "n", its band and its wording. Below n=10 the band is
``too_few`` and the caller (``lib/reviewDrafts.js``) renders it behind a reveal (a collapsed
toggle), never plainly.

**Dollar impact.** ``netPnl`` is the exact sum of the cited trades' ``pnlDollarNet`` (fees
already subtracted) — a finding's ``trades`` always sum to its ``dollarImpact.netPnl``, by
construction, never reconciled after the fact. ``baselineAvgR`` /
``baselineAvgNetPnlPerTrade`` are the period's own baseline (`baseline_stats`, computed ONCE
over every trade in the period and passed in), so every finding is measured against the same
number.

**No model client reachable.** Nothing in this module imports an LLM client, and nothing it
calls does either (`revenge_detect`, `sample_size`, `plan_grading`'s pure check functions, and
the entry-context/verdict-scorecard fields are all pre-computed data this module only reads).
"""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from typing import Any

from api.services.journal_two import revenge_detect, sample_size
from api.services.journal_two.plan_grading import STATUS_MEMBER_NONE, STATUS_UNPLANNED
from api.services.journal_two.verdict_scorecard import verdict_label_from_context
from api.services.placeholder_stop import is_placeholder_stop

#: A position entered after a loss whose dollar risk exceeds the period's own median risk by
#: this multiple is "sizing up after a loss". 1.5x is a deliberate, documented threshold —
#: large enough that an ordinary size variance does not fire, small enough that a real
#: tilt-sized add does.
SIZE_UP_MULTIPLE = 1.5

#: A regime the entry-context field calls unfavourable (13E's vocabulary: green/amber/orange/
#: red). Amber is NOT included — it is the market's normal caution state, not a red flag.
UNFAVOURABLE_REGIMES = frozenset({"orange", "red"})


def _hour_label(hour_et: int) -> str:
    """A plain-English ET hour window, e.g. 10 -> "10:00-11:00 AM ET"."""
    def fmt(h: int) -> str:
        h24 = h % 24
        ampm = "AM" if h24 < 12 else "PM"
        h12 = h24 % 12 or 12
        return f"{h12}:00 {ampm}"
    return f"{fmt(hour_et)}-{fmt(hour_et + 1)} ET"


def baseline_stats(trades: list[dict[str, Any]]) -> dict[str, Any]:
    """The period's own baseline — every finding is measured against THIS, computed once.

    Never a second authority over the period's own P&L: this is a plain mean over the same
    trades `review_drafts.py` already fetched for the note's own "The numbers" section, not a
    restatement of `coach_data_assembler`'s aggregate (which has no per-trade R mean field).
    """
    rs = [t["rMultiple"] for t in trades if t.get("rMultiple") is not None]
    pnls = [t["pnlDollarNet"] for t in trades if t.get("pnlDollarNet") is not None]
    return {
        "n": len(trades),
        "avgR": round(sum(rs) / len(rs), 4) if rs else None,
        "avgNetPnlPerTrade": round(sum(pnls) / len(pnls), 2) if pnls else None,
    }


def _trade_citation(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": t["id"], "tradeRef": t["tradeRef"], "symbol": t["symbol"],
        "exitDate": t.get("exitDate"), "pnlDollar": t["pnlDollarNet"], "rMultiple": t.get("rMultiple"),
    }


def _finding(kind: str, label: str, trades: list[dict[str, Any]], *, baseline: dict[str, Any],
            detail: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """The one finding shape. A finding with nothing to cite is not a finding -- `None`."""
    cited = [t for t in trades if t.get("rMultiple") is not None]
    if not cited:
        return None
    stat = sample_size.mean_stat([t["rMultiple"] for t in cited])
    net = sum(t["pnlDollarNet"] for t in cited)
    return {
        "kind": kind,
        "label": label,
        "sample": stat,
        "dollarImpact": {
            "netPnl": round(net, 2),
            "avgR": stat["mean"],
            "baselineAvgR": baseline.get("avgR"),
            "baselineAvgNetPnlPerTrade": baseline.get("avgNetPnlPerTrade"),
        },
        "trades": [_trade_citation(t) for t in cited],
        "detail": dict(detail or {}),
    }


# ── detectors ──────────────────────────────────────────────────────────────────────────────


def _detect_revenge(trades: list[dict[str, Any]], baseline: dict[str, Any],
                    suppressed_pairs: frozenset[str]) -> dict[str, Any] | None:
    rows = [
        {
            "id": t["tradeRef"], "tradeRef": t["tradeRef"], "symbol": t["symbol"],
            "entry_date": t["entryDate"], "exit_date": t["exitDate"],
            "pnlDollar": t["pnlDollarGross"], "pnlDollarNet": t["pnlDollarNet"],
        }
        for t in trades
    ]
    result = revenge_detect.detect(rows, suppressed_pairs=suppressed_pairs)
    flagged = {f["tradeRef"] for f in result["flags"]}
    cited = [t for t in trades if t["tradeRef"] in flagged]
    return _finding(
        "revenge_reentry", "Revenge re-entries", cited, baseline=baseline,
        detail={"flags": result["flags"], "timeComponentCoverage": result["timeComponentCoverage"]},
    )


def _dollar_risk(t: dict[str, Any]) -> float | None:
    """Entered dollar risk: shares x |entry - stop|, or None when the stop is a placeholder
    (a broker mirror of the entry, never a real risk number) or absent."""
    stop = t.get("originalStop")
    entry = t.get("entryPrice")
    shares = t.get("shares")
    if stop is None or entry is None or shares is None:
        return None
    if is_placeholder_stop(stop, entry):
        return None
    return abs(float(entry) - float(stop)) * float(shares)


def _detect_size_up_after_loss(trades: list[dict[str, Any]], baseline: dict[str, Any]) -> dict[str, Any] | None:
    ordered = sorted(trades, key=lambda t: (t.get("exitDate") or "", t["tradeRef"]))
    risks = [r for r in (_dollar_risk(t) for t in ordered) if r is not None and r > 0]
    if len(risks) < 2:
        return None
    median_risk = statistics.median(risks)
    if median_risk <= 0:
        return None
    cited = []
    for i in range(1, len(ordered)):
        prev, cur = ordered[i - 1], ordered[i]
        if prev.get("result") != "Loss":
            continue
        risk = _dollar_risk(cur)
        if risk is None or risk <= median_risk * SIZE_UP_MULTIPLE:
            continue
        cited.append(cur)
    return _finding(
        "size_up_after_loss", "Sizing up after a loss", cited, baseline=baseline,
        detail={"medianRiskDollars": round(median_risk, 2), "thresholdMultiple": SIZE_UP_MULTIPLE},
    )


def _detect_weak_time_window(trades: list[dict[str, Any]], baseline: dict[str, Any]) -> dict[str, Any] | None:
    if baseline.get("avgR") is None:
        return None
    buckets: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for t in trades:
        if t.get("hourEt") is None or t.get("rMultiple") is None:
            continue
        buckets[t["hourEt"]].append(t)
    worst_hour, worst_avg = None, None
    for hour, items in buckets.items():
        avg = sum(x["rMultiple"] for x in items) / len(items)
        if worst_avg is None or avg < worst_avg:
            worst_avg, worst_hour = avg, hour
    if worst_hour is None or worst_avg >= baseline["avgR"]:
        return None
    return _finding(
        "weak_time_window", "A weak time window", buckets[worst_hour], baseline=baseline,
        detail={"hourEt": worst_hour, "hourLabel": _hour_label(worst_hour)},
    )


def _detect_regime_at_entry(trades: list[dict[str, Any]], baseline: dict[str, Any]) -> dict[str, Any] | None:
    cited = []
    by_regime: Counter[str] = Counter()
    for t in trades:
        ctx = t.get("entryContext")
        if not ctx:
            continue
        regime = (((ctx.get("fields") or {}).get("regime")) or {}).get("value")
        if regime in UNFAVOURABLE_REGIMES:
            cited.append(t)
            by_regime[regime] += 1
    return _finding(
        "regime_at_entry", "Regime at entry", cited, baseline=baseline,
        detail={"byRegime": dict(by_regime)},
    )


def _detect_held_into_earnings(trades: list[dict[str, Any]], baseline: dict[str, Any]) -> dict[str, Any] | None:
    cited = []
    for t in trades:
        ctx = t.get("entryContext")
        if not ctx:
            continue
        earnings = ((ctx.get("fields") or {}).get("days_to_earnings")) or {}
        report_date = (earnings.get("detail") or {}).get("reportDate")
        if not report_date:
            continue
        entry_day = (t.get("entryDate") or "")[:10]
        exit_day = (t.get("exitDate") or "")[:10]
        if entry_day and exit_day and entry_day <= report_date <= exit_day:
            cited.append(t)
    return _finding("held_into_earnings", "Holding into earnings", cited, baseline=baseline, detail={})


def _detect_skip_overridden(trades: list[dict[str, Any]], baseline: dict[str, Any],
                            verdict_scorecard: dict[str, Any] | None) -> dict[str, Any] | None:
    if not verdict_scorecard:
        return None
    headline = verdict_scorecard.get("skipOverrideHeadline")
    if not headline or not headline.get("n"):
        return None
    cited = []
    for t in trades:
        vid, label = verdict_label_from_context(t.get("contextAtEntry"))
        if vid is not None and label == "SKIP":
            cited.append(t)
    return _finding(
        "skip_overridden", "Compass SKIP overridden", cited, baseline=baseline,
        detail={
            "lossRate": headline.get("lossRate"), "losses": headline.get("losses"),
            "decisive": headline.get("decisive"),
        },
    )


def _detect_unplanned(trades: list[dict[str, Any]], baseline: dict[str, Any]) -> dict[str, Any] | None:
    cited = [t for t in trades if t.get("status") in (STATUS_UNPLANNED, STATUS_MEMBER_NONE)]
    return _finding("unplanned_trades", "Unplanned trades", cited, baseline=baseline, detail={})


def _detect_stops_not_honoured(trades: list[dict[str, Any]], baseline: dict[str, Any]) -> dict[str, Any] | None:
    cited = [
        t for t in trades
        if isinstance(t.get("checks"), dict) and (t["checks"].get("stop") or {}).get("state") == "missed"
    ]
    return _finding("stops_not_honoured", "Stops not honoured", cited, baseline=baseline, detail={})


def find_leaks(
    trades: list[dict[str, Any]],
    *,
    baseline: dict[str, Any],
    verdict_scorecard: dict[str, Any] | None = None,
    suppressed_revenge_pairs: frozenset[str] = frozenset(),
) -> list[dict[str, Any]]:
    """Every leak the period's trades support. A detector with nothing to cite contributes
    nothing -- the list holds only real findings, never a placeholder."""
    detectors = (
        lambda: _detect_revenge(trades, baseline, suppressed_revenge_pairs),
        lambda: _detect_size_up_after_loss(trades, baseline),
        lambda: _detect_weak_time_window(trades, baseline),
        lambda: _detect_regime_at_entry(trades, baseline),
        lambda: _detect_held_into_earnings(trades, baseline),
        lambda: _detect_skip_overridden(trades, baseline, verdict_scorecard),
        lambda: _detect_unplanned(trades, baseline),
        lambda: _detect_stops_not_honoured(trades, baseline),
    )
    out = []
    for d in detectors:
        finding = d()
        if finding is not None:
            out.append(finding)
    return out
