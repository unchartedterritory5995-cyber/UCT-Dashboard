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
from pathlib import Path

from api.services.journal_two import calculations as calc
from api.services.journal_two import options as opt

BE_OFF = {"enabled": False, "unit": "$", "value": 0.0}
BE_PCT = {"enabled": True, "unit": "%", "value": 0.5}

EQUITY_CASES = [
    # (side, entry, exit, shares, stop, entry_date, exit_date, breakeven)
    ("Long", 29.57, 34.50, 100, 27.99, "2026-03-02T14:35:00Z", "2026-03-09T18:10:00Z", BE_OFF),
    ("Short", 50.0, 45.0, 200, 52.5, "2026-03-02", "2026-03-04", BE_OFF),
    ("Long", 10.0, 10.0, 100, 9.5, "2026-03-02", "2026-03-02", BE_OFF),      # exact zero => BE
    ("Long", 100.0, 100.4, 50, 99.0, "2026-03-02", "2026-03-03", BE_PCT),     # inside % threshold
    ("Long", 100.0, 100.0, 10, 100.0, "2026-03-02", "2026-03-01", BE_OFF),    # stop==entry (R null) + negative hold
]

OPTION_LEG_SETS = [
    [{"side": "buy", "qty": 1, "entryPrice": 2.50, "exitPrice": 4.10}],
    [{"side": "buy", "qty": 1, "entryPrice": 3.00, "exitPrice": 1.00},
     {"side": "sell", "qty": 1, "entryPrice": 1.20, "exitPrice": 0.30}],
    [{"side": "sell", "qty": 2, "entryPrice": 1.10, "exitPrice": None}],      # open leg => netExit null
]


def main() -> None:
    fixtures = {"equity": [], "options": []}
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
    for legs in OPTION_LEG_SETS:
        py_legs = [{"side": l["side"], "qty": l["qty"], "entry_price": l["entryPrice"],
                    "exit_price": l["exitPrice"]} for l in legs]
        ne = opt.compute_net_entry(py_legs)
        nx = opt.compute_net_exit(py_legs)
        fixtures["options"].append({
            "inputs": {"legs": legs},
            "expected": {
                "netEntry": ne,
                "netExit": nx,
                "pnl": opt.compute_pnl(ne, nx, 0, 0) if nx is not None else None,
                "debitCredit": opt.classify_debit_credit(ne),
            },
        })
    out = Path(__file__).resolve().parents[3] / "app" / "src" / "lib" / "journal-2-0" / "parity-fixtures.json"
    out.write_text(json.dumps(fixtures, indent=2))
    print(f"wrote {out} ({len(fixtures['equity'])} equity, {len(fixtures['options'])} option cases)")


if __name__ == "__main__":
    main()
