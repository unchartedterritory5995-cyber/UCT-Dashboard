"""Verify the CONSENSUS (tier-1) path of the Earnings model against live providers.

WHY THIS EXISTS
The Earnings tab's forward-looking half - estimates, surprise, beat rates,
acceleration - only exists when FMP/Finnhub keys are configured. A development
machine without keys exercises tier 2 (yfinance actuals) only, so unit tests and
local screenshots cannot prove that half works. This script closes that gap: run
it once in an environment that HAS the keys.

    FMP_API_KEY=... FINNHUB_API_KEY=... python scripts/verify_earnings_consensus.py
    python scripts/verify_earnings_consensus.py MU NVDA AAPL      # pick tickers

It calls the service directly (no HTTP, no auth) and checks the invariants that
matter, rather than just printing a payload and hoping someone reads it.

Exit code 0 = every checked invariant held. 1 = at least one failed.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFAULT = ["MU", "NVDA", "AAPL", "MSFT", "AVGO", "WMT", "KO", "JPM"]


def _fmt(v, kind=""):
    if v is None:
        return "-"
    if kind == "money":
        a = abs(v)
        for div, suf in ((1e12, "T"), (1e9, "B"), (1e6, "M")):
            if a >= div:
                return f"${v / div:.2f}{suf}"
        return f"${v:,.0f}"
    if kind == "pct":
        return f"{v:+.1f}%"
    if kind == "eps":
        return f"${v:.2f}"
    return f"{v:.1f}" if isinstance(v, float) else str(v)


def check(sym, payload, problems):
    """Assert the invariants that only a keyed environment can exercise."""
    meta = payload.get("meta") or {}
    summary = payload.get("summary") or {}
    quarters = payload.get("quarters") or []
    estimates = payload.get("estimates") or []

    def fail(msg):
        problems.append(f"{sym}: {msg}")

    if not meta.get("estimates_available"):
        fail("NO CONSENSUS - tier 1 returned nothing. Keys set? Plan entitled? "
             "Everything below is the tier-2 fallback, not what this script tests.")
        return

    # 1. Consensus quarters must actually carry estimates and a comparable basis.
    scored = [q for q in quarters if q.get("eps_estimate") is not None]
    if not scored:
        fail("estimates_available is true but no quarter carries an eps_estimate")
    for q in scored:
        if q.get("eps_basis") != "consensus_comparable":
            fail(f"{q['label']} has an estimate but basis {q.get('eps_basis')!r}")
        if q.get("eps_actual") is not None and q.get("eps_surprise_pct") is None \
                and q.get("eps_surprise_abs") is None:
            fail(f"{q['label']} has actual+estimate on one basis but no surprise")

    # 2. A surprise must never be manufactured across bases.
    for q in quarters:
        if q.get("eps_basis") == "gaap_diluted" and q.get("eps_surprise_pct") is not None:
            fail(f"{q['label']} manufactured a surprise on a GAAP actual")

    # 3. Beat flags: missing consensus is NOT SCORED, never a miss.
    for q in quarters:
        if q.get("rev_estimate") is None and q.get("rev_beat") is not None:
            fail(f"{q['label']} scored a revenue beat with no revenue estimate")
        if q.get("eps_beat") is None and q.get("double_beat") is True:
            fail(f"{q['label']} double_beat is true with an unscored EPS beat")

    # 4. Forward quarters: labelled, priced, and growing against a real actual.
    if not estimates:
        fail("consensus present but NO forward quarters - the Estimates section "
             "will not render")
    for e in estimates:
        if not e.get("label"):
            fail("a forward quarter has no fiscal label")
        if e.get("eps_estimate") is None and e.get("revenue_estimate") is None:
            fail(f"{e.get('label')} forward row carries neither estimate")
        if e.get("eps_yoy_pct") is not None and e.get("yoy_basis") != "vs_actual":
            fail(f"{e.get('label')} forward growth is not measured against an actual")

    # 5. Acceleration needs 6+ quarters of history to exist at all.
    if len(quarters) >= 6 and summary.get("eps_accel_quarters") is None \
            and summary.get("eps_trend") is None:
        # Legitimate (flat growth), so a note rather than a failure.
        print(f"    note: {len(quarters)} quarters but no EPS acceleration run "
              f"(flat or interrupted growth - legitimate)")

    # 6. Beat rates must not exceed their sample.
    for a, b in (("eps_beats", "eps_beats_of"), ("rev_beats", "rev_beats_of")):
        n, of = summary.get(a), summary.get(b)
        if n is not None and of is not None and n > of:
            fail(f"{a}={n} exceeds {b}={of}")


def main(argv):
    tickers = argv[1:] or DEFAULT
    if not os.environ.get("FMP_API_KEY") and not os.environ.get("FINNHUB_API_KEY"):
        print("!! Neither FMP_API_KEY nor FINNHUB_API_KEY is set.")
        print("    This script only proves anything in an environment that has them.\n")

    from api.services.earnings_intel import _build

    problems: list[str] = []
    for sym in tickers:
        print(f"\n{'=' * 78}\n{sym}\n{'=' * 78}")
        try:
            payload = _build(sym)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{sym}: build raised {e!r}")
            print(f"  ERROR {e!r}")
            continue

        meta = payload.get("meta") or {}
        s = payload.get("summary") or {}
        cal = meta.get("fiscal_calendar") or {}
        print(f"  source={meta.get('actuals_source')}  consensus={meta.get('estimates_available')}  "
              f"quarters={len(payload.get('quarters') or [])}  fiscal_year_end={cal.get('fiscal_year_end')}")

        print(f"\n  SNAPSHOT   next {s.get('next_report_date') or '-'} ({s.get('next_report_label') or '-'})  "
              f"EPS est {_fmt(s.get('next_eps_estimate'), 'eps')}  "
              f"Sales est {_fmt(s.get('next_revenue_estimate'), 'money')}")
        print(f"  QUALITY    EPS accel {s.get('eps_accel_quarters')} ({s.get('eps_trend')})  "
              f"Sales accel {s.get('rev_accel_quarters')} ({s.get('rev_trend')})  "
              f"EPS beats {s.get('eps_beats')}/{s.get('eps_beats_of')}  "
              f"Sales beats {s.get('rev_beats')}/{s.get('rev_beats_of')}  "
              f"streak {s.get('double_beat_streak')}")
        print(f"             margin {_fmt(s.get('net_margin_pct'))}  "
              f"delta {_fmt(s.get('net_margin_delta_pp'))} pts")

        if payload.get("estimates"):
            print("\n  ESTIMATES")
            for e in payload["estimates"]:
                print(f"    {e['label']:<12} {_fmt(e.get('eps_estimate'), 'eps'):>10} "
                      f"{_fmt(e.get('eps_yoy_pct'), 'pct'):>9}   "
                      f"{_fmt(e.get('revenue_estimate'), 'money'):>11} "
                      f"{_fmt(e.get('rev_yoy_pct'), 'pct'):>9}   report {e.get('report_date') or '-'}")

        print("\n  REPORTED")
        for q in (payload.get("quarters") or [])[:8]:
            surp = (_fmt(q.get('eps_surprise_pct'), 'pct') if q.get('eps_surprise_pct') is not None
                    else (_fmt(q.get('eps_surprise_abs'), 'eps') if q.get('eps_surprise_abs') is not None else '-'))
            print(f"    {q['label']:<12} {_fmt(q.get('eps_actual'), 'eps'):>10} "
                  f"{_fmt(q.get('eps_yoy_pct'), 'pct'):>9}   "
                  f"{_fmt(q.get('revenue_actual'), 'money'):>11} "
                  f"{_fmt(q.get('rev_yoy_pct'), 'pct'):>9}   "
                  f"est {_fmt(q.get('eps_estimate'), 'eps'):>7} surp {surp:>8} "
                  f"basis {q.get('eps_basis')}")

        check(sym, payload, problems)

    print(f"\n{'=' * 78}")
    if problems:
        print(f"FAILED - {len(problems)} problem(s):")
        for p in problems:
            print(f"  x {p}")
        return 1
    print("PASSED - every consensus invariant held.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
