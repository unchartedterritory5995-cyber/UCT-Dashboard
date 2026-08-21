"""Journal 2.0 — tax book-of-record (Form-8949-style lines + wash-sale flags).

One closed EQUITY trade = one report line: description, acquired/sold dates,
proceeds, cost basis, gain/loss, short-vs-long-term (hold > 365 days = long),
plus a WASH-SALE flag when shares of the same symbol were acquired within the
IRS ±30-day window around a loss sale.

HONESTY CONTRACT (CoverageLine idiom — different facts stay different):
  - This is an ESTIMATE for review, not tax advice and not a 1099-B. The
    payload carries ``disclaimer`` verbatim and the FE must render it.
  - Wash detection is SAME-SYMBOL only (the IRS "substantially identical"
    test can reach options/similar ETFs — we do not guess at that; the
    docstring'd rule is what the number means).
  - ``optionsExcluded`` counts the year's closed option strategies that are
    NOT in the lines — surfaced, never silently dropped.
  - Proceeds/basis derive from price × shares (fees reported separately per
    line) so the arithmetic is auditable; a row missing entry/exit price is
    counted in ``notComputable`` and excluded from totals, never guessed.

Wash-sale rule implemented (v1, documented so the number is checkable):
  For each losing closed trade L, replacement acquisitions = OTHER entries in
  the same symbol (closed trades' entry OR still-open positions' entry, same
  account scope) dated within 30 days before/after L's exit. Disallowed
  estimate = loss × min(1, replacement_shares / L.shares) — the IRS pro-rata
  share rule. The triggering acquisitions are named on the line so the user
  can verify against their broker's 1099-B.
"""

from __future__ import annotations

import sqlite3
from datetime import date as _date
from typing import Any

from api.services.auth_db import get_connection

_WASH_WINDOW_DAYS = 30
_LONG_TERM_DAYS = 365

DISCLAIMER = (
    "Estimate for review — not tax advice. Wash-sale detection is same-symbol "
    "only and options are excluded from wash matching. Verify against your "
    "broker's 1099-B before filing."
)


def _day(iso: str | None) -> str | None:
    """ET-day slice of an ISO date/datetime string; None passes through."""
    if not iso:
        return None
    return str(iso)[:10]


def _days_between(a: str | None, b: str | None) -> int | None:
    try:
        da = _date.fromisoformat(a)  # type: ignore[arg-type]
        db = _date.fromisoformat(b)  # type: ignore[arg-type]
        return abs((db - da).days)
    except (TypeError, ValueError):
        return None


def get_tax_report(
    user_id: str,
    year: int,
    *,
    account_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Build the year's tax book. Lines are closed equity trades whose exit
    date falls in ``year``; wash matching looks at a ±30-day halo around the
    year boundary too (a January re-entry washes a late-December loss)."""
    own = conn is None
    conn = conn or get_connection()
    try:
        lo, hi = f"{year}-01-01", f"{year}-12-31"

        base = "user_id = ?"
        params: list[Any] = [user_id]
        if account_id:
            base += " AND account_id = ?"
            params.append(account_id)

        rows = conn.execute(
            "SELECT id, symbol, side, shares, entry_price, entry_date, "
            "       exit_price, exit_date, pnl_dollar, fees, hold_days "
            "  FROM j2_trades "
            f" WHERE {base} "
            "   AND substr(COALESCE(trading_day_et, exit_date), 1, 10) BETWEEN ? AND ? "
            " ORDER BY exit_date ASC",
            params + [lo, hi],
        ).fetchall()

        # Acquisition ledger for wash matching: every entry (closed trades +
        # open positions) in the same scope, in the year ± the wash window.
        halo_lo, halo_hi = f"{year - 1}-12-01", f"{year + 1}-01-31"
        acq = conn.execute(
            "SELECT id, symbol, shares, entry_date FROM j2_trades "
            f" WHERE {base} AND substr(entry_date, 1, 10) BETWEEN ? AND ?",
            params + [halo_lo, halo_hi],
        ).fetchall()
        open_acq = conn.execute(
            "SELECT id, symbol, shares, entry_date FROM j2_positions "
            f" WHERE {base} AND closed_at IS NULL "
            "   AND substr(entry_date, 1, 10) BETWEEN ? AND ?",
            params + [halo_lo, halo_hi],
        ).fetchall()
        acq_by_symbol: dict[str, list[dict[str, Any]]] = {}
        for a in list(acq) + list(open_acq):
            acq_by_symbol.setdefault(a["symbol"], []).append(
                {"id": a["id"], "shares": a["shares"], "date": _day(a["entry_date"])}
            )

        # Options excluded (surfaced, never silently dropped).
        options_excluded = conn.execute(
            "SELECT COUNT(*) FROM j2_option_strategies "
            f" WHERE {base} AND status != 'open' "
            "   AND substr(COALESCE(closed_at, ''), 1, 10) BETWEEN ? AND ?",
            params + [lo, hi],
        ).fetchone()[0]

        lines: list[dict[str, Any]] = []
        not_computable = 0
        totals = {
            "shortTermGain": 0.0,
            "longTermGain": 0.0,
            "washDisallowedEstimate": 0.0,
            "feesTotal": 0.0,
        }

        for r in rows:
            shares = r["shares"]
            entry_p, exit_p = r["entry_price"], r["exit_price"]
            if shares is None or entry_p is None or exit_p is None:
                not_computable += 1
                continue

            shares = float(shares)
            basis = round(float(entry_p) * shares, 2)
            proceeds = round(float(exit_p) * shares, 2)
            sign = 1 if r["side"] == "Long" else -1
            gain = round(sign * (proceeds - basis), 2)
            fees = float(r["fees"] or 0)

            hold = r["hold_days"]
            if hold is None:
                hold = _days_between(_day(r["entry_date"]), _day(r["exit_date"]))
            long_term = hold is not None and hold > _LONG_TERM_DAYS

            # Wash-sale check: losses only.
            wash = None
            if gain < 0:
                sold_day = _day(r["exit_date"])
                repl: list[dict[str, Any]] = []
                repl_shares = 0.0
                for a in acq_by_symbol.get(r["symbol"], []):
                    if a["id"] == r["id"]:
                        continue  # the sold lot's own entry is not a replacement
                    d = _days_between(a["date"], sold_day)
                    if d is not None and d <= _WASH_WINDOW_DAYS:
                        repl.append({"date": a["date"], "shares": a["shares"]})
                        repl_shares += float(a["shares"] or 0)
                if repl:
                    frac = min(1.0, repl_shares / shares) if shares > 0 else 1.0
                    disallowed = round(-gain * frac, 2)
                    wash = {
                        "disallowedEstimate": disallowed,
                        "replacementShares": repl_shares,
                        "replacements": repl[:5],
                    }
                    totals["washDisallowedEstimate"] += disallowed

            if long_term:
                totals["longTermGain"] += gain
            else:
                totals["shortTermGain"] += gain
            totals["feesTotal"] += fees

            lines.append({
                "symbol": r["symbol"],
                "description": f"{shares:g} sh {r['symbol']}"
                               + (" (short)" if r["side"] == "Short" else ""),
                "acquired": _day(r["entry_date"]),
                "sold": _day(r["exit_date"]),
                "proceeds": proceeds,
                "basis": basis,
                "gain": gain,
                "fees": round(fees, 2),
                "term": "long" if long_term else "short",
                "washSale": wash,
            })

        for k in totals:
            totals[k] = round(totals[k], 2)

        return {
            "year": year,
            "lines": lines,
            "totals": totals,
            "coverage": {
                "eligible": len(rows),
                "reported": len(lines),
                "notComputable": not_computable,
                "optionsExcluded": options_excluded,
            },
            "disclaimer": DISCLAIMER,
        }
    finally:
        if own:
            conn.close()
