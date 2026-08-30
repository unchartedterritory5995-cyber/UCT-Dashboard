"""Emit golden parity fixtures from the PYTHON implementations (authority).

Usage:  python -m api.services.journal_two.tools_emit_parity_fixtures
Writes: app/src/lib/journal-2-0/parity-fixtures.json (commit the output).

Python (api/services/journal_two) is the source of truth per the truth-spine
spec §3. Both stacks read the committed JSON: Vite imports it natively in
parity.test.js; pytest loads it via json.load in test_parity_fixtures.py.
NEVER hand-edit parity-fixtures.json — regenerate it here after any
intentional Python calc change.
"""
from __future__ import annotations

import json
from datetime import date as Date
from pathlib import Path

from api.services.journal_two import calculations as calc
from api.services.journal_two import options as opt
from api.services.journal_two.broker import composition

BE_OFF = {"enabled": False, "unit": "$", "value": 0.0}
BE_PCT = {"enabled": True, "unit": "%", "value": 0.5}

# Pinned as-of date for DTE cases. Python calls compute_days_to_expiration with
# as_of=Date.fromisoformat(AS_OF); JS calls computeDaysToExpiration with
# new Date(AS_OF + 'T12:00:00Z') — the noon-UTC anchor makes JS's Math.round
# land on Python's whole-day (date − date).days integer for any date pair.
AS_OF = "2026-07-01"

EQUITY_CASES = [
    # (side, entry, exit, shares, stop, entry_date, exit_date, breakeven)
    ("Long", 29.57, 34.50, 100, 27.99, "2026-03-02T14:35:00Z", "2026-03-09T18:10:00Z", BE_OFF),
    ("Short", 50.0, 45.0, 200, 52.5, "2026-03-02", "2026-03-04", BE_OFF),
    ("Long", 10.0, 10.0, 100, 9.5, "2026-03-02", "2026-03-02", BE_OFF),      # exact zero => BE
    ("Long", 100.0, 100.4, 50, 99.0, "2026-03-02", "2026-03-03", BE_PCT),     # inside % threshold
    ("Long", 100.0, 100.0, 10, 100.0, "2026-03-02", "2026-03-01", BE_OFF),    # stop==entry (R null) + negative hold
]

# (strategy_type, legs) — legs use camelCase field names exactly as the JS
# fixtures consume them; _py_leg maps to the snake_case the Python calcs expect.
# strike/expiration only present where compute_max_risk / DTE need them.
OPTION_CASES = [
    ("custom",
     [{"side": "buy", "qty": 1, "entryPrice": 2.50, "exitPrice": 4.10}]),
    ("custom",
     [{"side": "buy", "qty": 1, "entryPrice": 3.00, "exitPrice": 1.00},
      {"side": "sell", "qty": 1, "entryPrice": 1.20, "exitPrice": 0.30}]),
    ("custom",
     [{"side": "sell", "qty": 2, "entryPrice": 1.10, "exitPrice": None}]),    # open leg => netExit null
    # maxRisk + DTE coverage:
    ("long_call",                                                             # long single-leg: risk = net debit
     [{"side": "buy", "qty": 1, "entryPrice": 2.50, "exitPrice": 4.10,
       "strike": 100.0, "expiration": "2026-07-18"}]),
    ("vertical_credit_call",                                                  # credit spread: width×100×qty − credit
     [{"side": "sell", "qty": 1, "entryPrice": 1.20, "exitPrice": 0.30,
       "strike": 100.0, "expiration": "2026-08-21"},
      {"side": "buy", "qty": 1, "entryPrice": 0.40, "exitPrice": 0.05,
       "strike": 105.0, "expiration": "2026-08-21"}]),
    ("short_put",                                                             # naked short: maxRisk None; past expiry => negative DTE
     [{"side": "sell", "qty": 2, "entryPrice": 1.10, "exitPrice": None,
       "strike": 95.0, "expiration": "2026-06-19"}]),
]


# Net-liq COMPOSITION cases — the number the Open Positions hero shows.
# Python authority: broker/composition.py; JS mirror: brokerLiveSummary
# (marketValue + netLiq only — Today has its own tests). Case 0 is the
# 2026-08-26 incident book, pinned with its real numbers.
# The 2026-08-29 book as measured in prod. broker marks (brokerPrice) are
# Robinhood's own; prices are our vendor's Friday closes. Every one differs.
_AUG29_POSITIONS = [
    {"symbol": "DELL", "side": "Long", "shares": 5.0, "brokerPrice": 456.07,
     "source": "broker"},
    {"symbol": "ORCL", "side": "Long", "shares": 100.0, "brokerPrice": 150.72,
     "source": "broker"},
    {"symbol": "SNAP", "side": "Long", "shares": 2000.0, "brokerPrice": 5.445,
     "source": "broker"},
    {"symbol": "SPY", "side": "Long", "shares": 0.2606, "brokerPrice": 769.39,
     "source": "broker"},
    {"symbol": "TH", "side": "Long", "shares": 150.0, "brokerPrice": 18.56,
     "source": "broker"},
]
_AUG29_PRICES = {
    "DELL": {"price": 456.24}, "ORCL": {"price": 150.85}, "SNAP": {"price": 5.43},
    "SPY": {"price": 769.35}, "TH": {"price": 18.55},
}

COMPOSITION_CASES = [
    {   # incident book: fill-derived cash + live marks → the true ~$10.9k
        "account": {"balanceSource": "broker", "brokerCash": -18760.66,
                     "brokerCashLive": -29750.66},
        "positions": [
            {"symbol": "DELL", "side": "Long", "shares": 5.0,
             "brokerPrice": 463.69, "source": "broker"},
            {"symbol": "ORCL", "side": "Long", "shares": 100.0,
             "brokerPrice": 148.87, "source": "broker"},
            {"symbol": "NEXA", "side": "Long", "shares": 750.0,
             "brokerPrice": 15.58, "source": "broker"},
            {"symbol": "SPY", "side": "Long", "shares": 0.1568,
             "brokerPrice": 765.95, "source": "broker"},
            {"symbol": "SNAP", "side": "Long", "shares": 2000.0,
             "brokerPrice": 5.415, "source": "broker"},
        ],
        "strategies": [
            {"id": "s1", "brokerCurrentValue": 665.0, "netEntry": 610.0,
             "source": "broker"},
        ],
        "prices": {"SNAP": {"price": 5.4241}},
        "optionMarks": {},
    },
    {   # stale cash only (no brokerCashLive) → falls back to brokerCash
        "account": {"balanceSource": "broker", "brokerCash": 2000.0},
        "positions": [
            {"symbol": "AAPL", "side": "Long", "shares": 10, "brokerPrice": 90,
             "source": "broker"},
            {"symbol": "TSLA", "side": "Short", "shares": 5, "brokerPrice": 200,
             "source": "broker"},
        ],
        "strategies": [{"id": "s1", "brokerCurrentValue": 300.0,
                         "netEntry": 250.0, "source": "broker"}],
        "prices": {"AAPL": {"price": 100}, "TSLA": {"price": 210}},
        "optionMarks": {},
    },
    {   # MIRROR PURITY: manual rows in a broker account are excluded
        "account": {"balanceSource": "broker", "brokerCash": 0.0},
        "positions": [
            {"symbol": "AAPL", "side": "Long", "shares": 10, "brokerPrice": 100,
             "source": "broker"},
            {"symbol": "GME", "side": "Long", "shares": 1000, "brokerPrice": 25,
             "source": None},
        ],
        "strategies": [{"id": "m1", "brokerCurrentValue": 5000.0,
                         "netEntry": 4000.0, "source": None}],
        "prices": {},
        "optionMarks": {},
    },
    {   # just-filled broker strategy, no mark stamped → values at netEntry
        "account": {"balanceSource": "broker", "brokerCash": -610.0},
        "positions": [],
        "strategies": [{"id": "s1", "brokerCurrentValue": None,
                         "netEntry": 610.0, "source": "broker"}],
        "prices": {},
        "optionMarks": {},
    },
    {   # live option mark beats the sync value
        "account": {"balanceSource": "broker", "brokerCash": 0.0},
        "positions": [],
        "strategies": [{"id": "s1", "brokerCurrentValue": 665.0,
                         "netEntry": 610.0, "source": "broker"}],
        "prices": {},
        "optionMarks": {"s1": {"currentValue": 700.0}},
    },
    {   # manual (non-broker) account: no source filter, no netEntry fallback
        "account": {"balanceSource": "manual", "brokerCash": 100.0},
        "positions": [{"symbol": "AAPL", "side": "Long", "shares": 2,
                        "brokerPrice": 50, "source": None}],
        "strategies": [{"id": "m1", "brokerCurrentValue": None,
                         "netEntry": 999.0, "source": None}],
        "prices": {},
        "optionMarks": {},
    },
    {   # unknown cash → netLiq null, marketValue still composed
        "account": {"balanceSource": "broker"},
        "positions": [{"symbol": "X", "side": "Long", "shares": 1,
                        "brokerPrice": 10, "source": "broker"}],
        "strategies": [],
        "prices": {"X": {"price": 10}},
        "optionMarks": {},
    },
    {   # 2026-08-29 SATURDAY, live marks — the $9,708.44 the owner reported
        # while Robinhood showed $9,728.40. Pinned as the incident book.
        "account": {"balanceSource": "broker", "brokerCash": -22165.75,
                     "brokerBalanceSyncedAt": "2026-08-29T07:40:30+00:00"},
        "positions": _AUG29_POSITIONS,
        "strategies": [{"id": "s1", "brokerCurrentValue": 675.0,
                         "netEntry": 610.0, "source": "broker"}],
        "prices": _AUG29_PRICES,
        "optionMarks": {"s1": {"currentValue": 665.0}},
    },
    {   # SAME book, session closed ⇒ equities at the BROKER's marks. The
        # option keeps its live mark (option_marks beats a lagging sync value —
        # a prior measured ruling this change does not revisit).
        "account": {"balanceSource": "broker", "brokerCash": -22165.75,
                     "brokerBalanceSyncedAt": "2026-08-29T07:40:30+00:00"},
        "positions": _AUG29_POSITIONS,
        "strategies": [{"id": "s1", "brokerCurrentValue": 675.0,
                         "netEntry": 610.0, "source": "broker"}],
        "prices": _AUG29_PRICES,
        "optionMarks": {"s1": {"currentValue": 665.0}},
        "preferBroker": True,
    },
    {   # PREFERENCE, NOT RESTRICTION: a provisional row with no broker mark
        # still prices off the live feed under prefer_broker. Dropping it would
        # debit cash for a position missing from market value (2026-08-26).
        "account": {"balanceSource": "broker", "brokerCash": 0.0},
        "positions": [
            {"symbol": "A", "side": "Long", "shares": 10, "brokerPrice": 50,
             "source": "broker"},
            {"symbol": "NEW", "side": "Long", "shares": 10, "source": "broker"},
        ],
        "strategies": [],
        "prices": {"A": {"price": 51}, "NEW": {"price": 4}},
        "optionMarks": {},
        "preferBroker": True,
    },
]

# The 2026-08-29 book, measured in prod: broker marks vs our vendor's closes.
_MARK_PREFERENCE_CASES = [
    # (label, account, session_closed, last_closed_session_et)
    ("closed session, sync after the close → broker marks",
     {"brokerBalanceSyncedAt": "2026-08-29T07:40:30+00:00"}, True, "2026-08-28"),
    ("session open → never (stored marks are the PREVIOUS close)",
     {"brokerBalanceSyncedAt": "2026-08-29T07:40:30+00:00"}, False, "2026-08-28"),
    ("weekday evening, sync predates that day's close → refused",
     {"brokerBalanceSyncedAt": "2026-08-28T07:40:30+00:00"}, True, "2026-08-28"),
    ("sync exactly at 16:00 ET on the session's date → counts",
     {"brokerBalanceSyncedAt": "2026-08-28T20:00:00+00:00"}, True, "2026-08-28"),
    ("one minute before the close → does not",
     {"brokerBalanceSyncedAt": "2026-08-28T19:59:00+00:00"}, True, "2026-08-28"),
    ("naive stamp is read as UTC, never local",
     {"brokerBalanceSyncedAt": "2026-08-29T07:40:30"}, True, "2026-08-28"),
    ("missing watermark → refused", {}, True, "2026-08-28"),
    ("unparseable watermark → refused",
     {"brokerBalanceSyncedAt": "not-a-date"}, True, "2026-08-28"),
]


def _py_leg(leg: dict) -> dict:
    out = {"side": leg["side"], "qty": leg["qty"],
           "entry_price": leg["entryPrice"], "exit_price": leg["exitPrice"]}
    if "strike" in leg:
        out["strike"] = leg["strike"]
    if "expiration" in leg:
        out["expiration"] = leg["expiration"]
    return out


def main() -> None:
    fixtures = {"equity": [], "options": [], "composition": [],
                "markPreference": []}
    for case in COMPOSITION_CASES:
        fixtures["composition"].append({
            "inputs": case,
            "expected": composition.compose_net_liq(
                case["account"], case["positions"], case["strategies"],
                case["prices"], case["optionMarks"],
                case.get("preferBroker", False),
            ),
        })
    for label, account, closed, last_close in _MARK_PREFERENCE_CASES:
        fixtures["markPreference"].append({
            "label": label,
            "inputs": {"account": account, "sessionClosed": closed,
                        "lastClosedSessionET": last_close},
            "expected": composition.prefer_broker_marks(account, closed, last_close),
        })
    for side, e, x, sh, stop, ed, xd, be in EQUITY_CASES:
        pnl = calc.trade_pnl_dollar(side, e, x, sh)
        fixtures["equity"].append({
            "inputs": {"side": side, "entryPrice": e, "exitPrice": x, "shares": sh,
                        "originalStop": stop, "entryDate": ed, "exitDate": xd,
                        "breakevenRange": be},
            "expected": {
                "pnlDollar": pnl,
                "pnlPercent": calc.trade_pnl_percent(side, e, x),
                "rMultiple": calc.trade_r_multiple(side, e, x, stop),
                "holdDays": calc.hold_days(ed, xd),
                "result": calc.trade_result(pnl, e, sh, be),
            },
        })
    for strategy_type, legs in OPTION_CASES:
        py_legs = [_py_leg(l) for l in legs]
        ne = opt.compute_net_entry(py_legs)
        nx = opt.compute_net_exit(py_legs)
        fixtures["options"].append({
            "inputs": {"strategyType": strategy_type, "legs": legs, "asOf": AS_OF},
            "expected": {
                "netEntry": ne,
                "netExit": nx,
                "pnl": opt.compute_pnl(ne, nx, 0, 0) if nx is not None else None,
                "debitCredit": opt.classify_debit_credit(ne),
                "maxRisk": opt.compute_max_risk(strategy_type, py_legs, ne),
                "dte": opt.compute_days_to_expiration(
                    py_legs, as_of=Date.fromisoformat(AS_OF)),
            },
        })
    out = Path(__file__).resolve().parents[3] / "app" / "src" / "lib" / "journal-2-0" / "parity-fixtures.json"
    out.write_text(json.dumps(fixtures, indent=2))
    print(f"wrote {out} ({len(fixtures['equity'])} equity, "
          f"{len(fixtures['options'])} option, "
          f"{len(fixtures['composition'])} composition, "
          f"{len(fixtures['markPreference'])} mark-preference cases)")


if __name__ == "__main__":
    main()
