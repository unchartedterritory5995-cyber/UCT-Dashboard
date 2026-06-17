"""SnapTrade live API SHAPE AUDIT — validate the adapter's assumptions vs reality.

The 147 broker unit tests validate LOGIC against mock data whose shapes are
*assumed*. This harness fetches the REAL SnapTrade JSON for the connected
account and runs it through the ACTUAL extraction code (snaptrade_adapter +
balances), reporting whether the fields/enums the code depends on actually
appear in live responses.

It de-risks the #1 unknown: ~25 hard-coded shape assumptions (field names,
enum strings, pagination envelope, currency/option object structure).

Reuses the smoke-test identity (tools/.snaptrade_smoke_state.json).
Raw captures are written to tools/.snaptrade_captures/ (gitignored).

Run from the worktree root:
  python tools/snaptrade_shape_audit.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

CAP = ROOT / "tools" / ".snaptrade_captures"
CAP.mkdir(exist_ok=True)

PASS, FAIL, INFO = "PASS", "FAIL", "INFO"
_results: list[tuple[str, str, str]] = []  # (status, label, detail)


def check(status: str, label: str, detail: str = "") -> None:
    _results.append((status, label, detail))


def _dump(name: str, obj) -> None:
    (CAP / f"{name}.json").write_text(json.dumps(obj, default=str, indent=2), encoding="utf-8")


def _keys(obj) -> list[str]:
    return sorted(obj.keys()) if isinstance(obj, dict) else []


async def main() -> None:
    st = json.loads((ROOT / "tools" / ".snaptrade_smoke_state.json").read_text())
    uid, sec = st["user_id"], st["user_secret"]

    from api.services.journal_two.broker import snaptrade_client as snap
    from api.services.journal_two.broker import snaptrade_adapter as ad
    from api.services.journal_two.broker import balances as bal
    from api.services.journal_two.broker import connections as conns

    # ── ACCOUNTS ──────────────────────────────────────────────────────────────
    accounts = await snap.list_accounts(uid, sec)
    _dump("accounts", accounts)
    check(INFO, f"accounts fetched: {len(accounts)}", "")
    for i, a in enumerate(accounts):
        check(PASS if a.get("id") else FAIL, f"account[{i}].id present", str(a.get("id")))
        summ = conns.summarize_account(a)
        check(PASS if summ["brokerage_name"] else FAIL,
              f"account[{i}] brokerage_name resolvable", str(summ["brokerage_name"]))
        check(INFO, f"account[{i}] keys", ", ".join(_keys(a)))
        check(INFO, f"account[{i}] summary", json.dumps(summ, default=str))

    if not accounts:
        _finish()
        return
    acc_id = accounts[0]["id"]

    # ── BALANCES ──────────────────────────────────────────────────────────────
    bals = await snap.get_balances(uid, sec, acc_id)
    _dump("balances", bals)
    check(INFO, f"balances fetched: {len(bals)}", "")
    for i, b in enumerate(bals):
        check(INFO, f"balance[{i}] keys", ", ".join(_keys(b)))
        has_cash = bal._num(b.get("cash")) is not None
        has_bp = bal._num(b.get("buying_power")) is not None
        check(PASS if has_cash else INFO, f"balance[{i}].cash numeric", str(b.get("cash")))
        check(PASS if has_bp else INFO, f"balance[{i}].buying_power numeric", str(b.get("buying_power")))
        check(PASS if bal._currency_code(b) else INFO,
              f"balance[{i}] currency resolvable", str(bal._currency_code(b)))
    cash, bp = bal.usd_cash_buying_power(bals)
    check(PASS if cash is not None else FAIL, "usd_cash_buying_power -> cash", str(cash))

    # ── POSITIONS ─────────────────────────────────────────────────────────────
    positions = await snap.get_positions(uid, sec, acc_id)
    _dump("positions", positions)
    check(INFO, f"positions fetched: {len(positions)}", "")
    for i, p in enumerate(positions):
        sym = bal._pos_symbol(p)
        units = bal._num(p.get("units"))
        price = bal._num(p.get("price"))
        avg = bal._num(p.get("average_purchase_price"))
        check(PASS if sym else FAIL, f"position[{i}] symbol resolvable", str(sym))
        check(PASS if units is not None else FAIL, f"position[{i}].units numeric", str(units))
        check(PASS if avg is not None else INFO,
              f"position[{i}].average_purchase_price (cost basis)", str(avg))
        check(INFO if price is not None else INFO, f"position[{i}].price (mark)", str(price))
        if i == 0:
            check(INFO, "position[0] keys", ", ".join(_keys(p)))
    mv = bal.market_value(positions)
    check(INFO, "market_value(positions)", str(mv))

    # ── ACTIVITIES ────────────────────────────────────────────────────────────
    from datetime import date
    acts = await snap.get_activities(uid, sec, acc_id,
                                     start_date=date(2015, 1, 1), end_date=date(2026, 6, 16),
                                     limit=200)
    data = acts.get("data", [])
    _dump("activities", acts)
    check(INFO, "activities envelope keys", ", ".join(_keys(acts)))
    check(PASS if "pagination" in acts else FAIL, "activities pagination envelope present",
          json.dumps(acts.get("pagination"), default=str))
    check(INFO, f"activities fetched: {len(data)}", "")

    if not data:
        check(INFO, "ACTIVITIES EMPTY",
              "SnapTrade has no transactions for this account yet (Robinhood async "
              "backfill). Re-run after a trade / backfill to audit activity shapes.")
    else:
        # Classify everything + flag any unknown type that would be skipped.
        buckets: dict[str, int] = {}
        unknown_types: set[str] = set()
        for a in data:
            kind = ad.classify(a)
            buckets[kind] = buckets.get(kind, 0) + 1
            if kind == "unknown":
                unknown_types.add(str(a.get("type")))
        check(INFO, "activity classification buckets", json.dumps(buckets))
        check(PASS if not unknown_types else FAIL,
              "all activity types classified (no unknowns)",
              f"unknown types: {sorted(unknown_types)}" if unknown_types else "ok")
        part = ad.partition(data)
        check(PASS if not part["skipped"] else FAIL,
              "all activities parsed (none skipped)",
              f"{len(part['skipped'])} skipped: {part['skipped'][:5]}" if part["skipped"] else "ok")
        check(INFO, "partition counts",
              f"equity_fills={len(part['equity_fills'])} options={len(part['option_events'])} "
              f"cash={len(part['cash'])} transfers={len(part['transfers'])}")
        # dump the first equity + option activity raw shape for eyeballing
        first_eq = next((a for a in data if ad.classify(a) == "equity_trade"), None)
        if first_eq:
            check(INFO, "first equity activity keys", ", ".join(_keys(first_eq)))
        first_opt = next((a for a in data
                          if ad.classify(a) in ("option_trade", "option_expiration",
                                                "option_assignment", "option_exercise")), None)
        if first_opt:
            check(INFO, "first option activity keys", ", ".join(_keys(first_opt)))

    _finish()


def _finish() -> None:
    print("\n" + "=" * 72)
    print("SNAPTRADE LIVE SHAPE AUDIT")
    print("=" * 72)
    n_pass = sum(1 for s, _, _ in _results if s == PASS)
    n_fail = sum(1 for s, _, _ in _results if s == FAIL)
    for status, label, detail in _results:
        mark = {"PASS": "[PASS]", "FAIL": "[FAIL]", "INFO": "[info]"}[status]
        line = f"{mark} {label}"
        if detail:
            line += f"  ->  {detail}"
        print(line)
    print("-" * 72)
    print(f"RESULT: {n_pass} pass, {n_fail} FAIL  (raw JSON captured -> {CAP})")
    if n_fail:
        print("\n*** MISMATCHES FOUND — the adapter's assumptions diverge from live SnapTrade.")
        print("    Patch snaptrade_adapter.py / balances.py and add a regression test")
        print("    seeded with the captured real shape.")


if __name__ == "__main__":
    asyncio.run(main())
