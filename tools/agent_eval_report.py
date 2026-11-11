"""UCT Agent — a VALUE-FREE daily spend report (owner's request, Wave 1 A-03). Read-only.

  python tools/agent_eval_report.py                       # the cumulative eval ledger, by day and run
  python tools/agent_eval_report.py --agent-db C:/path/uct_agent.db --catalyst-db C:/path/catalysts.db \\
         --auth-db C:/path/auth.db --days 14              # + the production tables, by ET day

Sections (dollars and counts only — never a member id, a message or a market value):
  eval ledger        tools/agent_eval_ledger.py `eval_spend` by day (reserved / settled / released, $)
  agent_spend        the production Agent ledger (api/services/uct_agent/budget.py) by `et_day`
  agent_telemetry    the Agent's per-turn `cost_usd` by ET day (api/services/uct_agent/store.py)
  catalyst_cost_log  the shared $15 ledger by `market_date` (api/services/catalyst/store.py)
  llm_route_cost_log narrative_cost_guard's per-surface rows by day (auth db)
Every database is opened read-only (`mode=ro`); a path not given is reported as "not given"; a table that
does not exist in the file is reported as such. Nothing is written anywhere.
"""
from __future__ import annotations

import argparse
import contextlib
import os
import sqlite3
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools import agent_eval_ledger as ledger  # noqa: E402

_ET = ZoneInfo("America/New_York")


def _ro(path: str) -> sqlite3.Connection:
    uri = "file:" + os.path.abspath(path).replace("\\", "/") + "?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=5.0)


def _et_day(epoch: int | float | None) -> str:
    try:
        return datetime.fromtimestamp(float(epoch), _ET).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError, OverflowError):
        return "?"


def _rows(path: str | None, sql: str, params=()) -> list[tuple] | str:
    if not path:
        return "not given"
    if not os.path.exists(path):
        return f"no such file: {path}"
    try:
        with contextlib.closing(_ro(path)) as c:
            return c.execute(sql, params).fetchall()
    except sqlite3.Error as e:
        return f"unreadable ({e})"


def _table(title: str, header: list[str], rows, fmt=None) -> list[str]:
    out = [f"## {title}"]
    if isinstance(rows, str):
        out.append(f"  ({rows})")
        return out
    out.append("  " + " | ".join(header))
    if not rows:
        out.append("  (no rows)")
    for r in rows:
        out.append("  " + " | ".join((fmt or (lambda v: str(v)))(v) for v in r))
    return out


def _money(v):
    return f"${v:.4f}" if isinstance(v, float) else str(v)


def eval_ledger_section(path: str, days: int) -> list[str]:
    rows = _rows(path, "SELECT created_at, status, reserved_usd, actual_usd, run_id FROM eval_spend ORDER BY id")
    if isinstance(rows, str):
        return _table("eval ledger (cumulative, all runs)", [], rows)
    by_day: dict[str, dict] = {}
    for created, status, reserved, actual, _run in rows:
        d = by_day.setdefault(_et_day(created), {"reserved": 0, "settled": 0, "released": 0, "reserved_usd": 0.0, "settled_usd": 0.0})
        d[status] = d.get(status, 0) + 1
        if status == "reserved":
            d["reserved_usd"] += float(reserved or 0)
        elif status == "settled":
            d["settled_usd"] += float(actual or 0)
    keys = sorted(by_day)[-days:]
    table = [(k, by_day[k]["reserved"], by_day[k]["settled"], by_day[k]["released"], by_day[k]["reserved_usd"], by_day[k]["settled_usd"]) for k in keys]
    out = _table("eval ledger (cumulative, all runs)", ["et_day", "open", "settled", "released", "open $", "settled $"], table, _money)
    try:
        s = ledger.Ledger(path, readonly=True).status()
        cap = f"${s['cap_usd']:.2f}" if s["cap_usd"] is not None else f"UNREADABLE ({s['cap_error']})"
        out.append(f"  cumulative: settled ${s['settled_usd']:.4f} + open ${s['reserved_usd']:.4f} = ${s['committed_usd']:.4f} of cap {cap}"
                   f"; remaining {('$%.4f' % s['remaining_usd']) if s['remaining_usd'] is not None else 'n/a'}")
        for r in sorted(s["runs"], key=lambda x: x["run_id"]):
            out.append(f"  run {r['run_id']} ({r['tool']}, key {r['key_fp']}): {r['calls']} calls, open ${r['reserved_usd']:.4f}, settled ${r['settled_usd']:.4f}")
    except Exception as e:  # noqa: BLE001
        out.append(f"  (status unavailable: {type(e).__name__})")
    return out


def agent_spend_section(path: str | None, days: int) -> list[str]:
    rows = _rows(path, "SELECT et_day, SUM(status='settled'), SUM(status='reserved'), SUM(status='released'),"
                       " COALESCE(SUM(CASE status WHEN 'settled' THEN actual_usd ELSE 0 END),0),"
                       " COALESCE(SUM(CASE status WHEN 'reserved' THEN reserved_usd ELSE 0 END),0)"
                       " FROM agent_spend GROUP BY et_day ORDER BY et_day DESC LIMIT ?", (days,))
    return _table("agent_spend (production Agent ledger, $5/day cap)", ["et_day", "settled", "open", "released", "settled $", "open $"], rows, _money)


def agent_telemetry_section(path: str | None, days: int) -> list[str]:
    rows = _rows(path, "SELECT created_at, cost_usd, path FROM agent_telemetry")
    if isinstance(rows, str):
        return _table("agent_telemetry (per-turn cost_usd)", [], rows)
    by_day: dict[str, dict] = {}
    for created, cost, path_ in rows:
        d = by_day.setdefault(_et_day(created), {"turns": 0, "model": 0, "usd": 0.0})
        d["turns"] += 1
        d["model"] += 1 if path_ in ("model", "routed", "reroute") else 0
        d["usd"] += float(cost or 0)
    keys = sorted(by_day, reverse=True)[:days]
    return _table("agent_telemetry (per-turn cost_usd)", ["et_day", "turns", "model turns", "$"],
                  [(k, by_day[k]["turns"], by_day[k]["model"], by_day[k]["usd"]) for k in keys], _money)


def catalyst_section(path: str | None, days: int) -> list[str]:
    rows = _rows(path, "SELECT market_date, COUNT(*), SUM(COALESCE(was_cached,0)), COALESCE(SUM(cost_usd),0)"
                       " FROM catalyst_cost_log GROUP BY market_date ORDER BY market_date DESC LIMIT ?", (days,))
    return _table("catalyst_cost_log (the shared $15 ledger)", ["market_date", "calls", "cached", "$"], rows, _money)


def route_cost_section(path: str | None, days: int) -> list[str]:
    rows = _rows(path, "SELECT substr(at,1,10), surface, COUNT(*), COALESCE(SUM(cost_usd),0) FROM llm_route_cost_log"
                       " GROUP BY substr(at,1,10), surface ORDER BY 1 DESC, 2 LIMIT ?", (days * 8,))
    return _table("llm_route_cost_log (narrative_cost_guard, UTC day)", ["day", "surface", "calls", "$"], rows, _money)


def report(*, ledger_path: str, agent_db: str | None, catalyst_db: str | None, auth_db: str | None, days: int) -> str:
    lines = [f"# UCT Agent spend report — {datetime.now(_ET).strftime('%Y-%m-%d %H:%M ET')} (values: counts and dollars only)"]
    lines += eval_ledger_section(ledger_path, days)
    lines += agent_spend_section(agent_db, days)
    lines += agent_telemetry_section(agent_db, days)
    lines += catalyst_section(catalyst_db, days)
    lines += route_cost_section(auth_db, days)
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default=None, help="the eval ledger (default: tools/agent_eval_ledger.py's path)")
    ap.add_argument("--agent-db", default=None, help="uct_agent.db (agent_spend + agent_telemetry)")
    ap.add_argument("--catalyst-db", default=None, help="catalysts.db (catalyst_cost_log)")
    ap.add_argument("--auth-db", default=None, help="auth.db (llm_route_cost_log)")
    ap.add_argument("--days", type=int, default=14)
    a = ap.parse_args(argv)
    try:
        path = a.ledger or ledger.ledger_path()
    except ledger.LedgerRefused as e:
        path = ledger.pinned_ledger()
        print(f"(ledger path: {e})")
    print(report(ledger_path=path, agent_db=a.agent_db, catalyst_db=a.catalyst_db, auth_db=a.auth_db, days=max(1, a.days)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
