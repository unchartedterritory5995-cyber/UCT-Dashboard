"""READ ONLY: one stock's deals (MNA) and index changes (IDXC) as this server already holds them.

`mergers.get_company()` and `index_changes.get_changes()` answer through their holds' `get()`, which STARTS the one
background build (a vendor search for the company's name, the latest-deals pages, the three index lists) when nothing is
held or a refresh is due, and with nothing held waits a few seconds on it. A reader that must never cause that work (the
UCT Agent's `company.deals` data kind, MD-1 §4.21) reads through the two functions below instead, over the holds' `peek()`
(never a build; the latest list and the index lists may be read once from this server's disk, as the holds themselves
do):

  held_mergers(sym)        the route's own company answer when one is held (`held`); else, when only the market's latest
                           list is held, the deals in it that name the stock's symbol, said as such (`latest_only`: the
                           name search has not been run for it); else `not_held`
  held_index_changes(sym)  the route's own answer for the stock over all three indexes (`get_changes("all", sym)`'s
                           filter and order, over the held lists), or `not_held`

Neither asks the vendor, resolves a name or writes anything. They live beside the services and not inside them, so the
services' own calls are unchanged. A rail drives each service over invented vendor answers and checks these readers then
give the routes' own answers, and nothing before.
"""
from __future__ import annotations

from typing import Optional


def _key(d: dict) -> tuple:
    return (d.get("date") or "", d.get("accepted_at") or "")


def held_mergers(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)`; `how` is `held`, `latest_only` or `not_held`. Never builds."""
    from api.services import mergers as svc
    s = (sym or "").upper().strip()
    if not s:
        return None, "not_held"
    got = svc._company.peek(s)
    if isinstance(got, dict) and got.get("status") == "ok" and isinstance(got.get("deals"), list):
        return dict(got), "held"
    latest = svc._latest.peek()
    if not isinstance(latest, dict) or latest.get("status") != "ok" or not isinstance(latest.get("deals"), list):
        return None, "not_held"
    found = [d for d in latest["deals"] if isinstance(d, dict)
             and ((d.get("acquirer") or {}).get("sym") == s or (d.get("target") or {}).get("sym") == s)]
    found.sort(key=_key, reverse=True)
    return {"status": "ok", "scope": "company", "sym": s, "name": None, "read_at": latest.get("read_at"),
            "source": svc.SOURCE, "check": latest.get("check"), "search": "not_run", "from_latest": len(found),
            "other_companies": 0, "dropped": 0, "cut": len(found) > svc.COMPANY_CAP,
            "deals": found[:svc.COMPANY_CAP], "latest_cut": bool(latest.get("cut"))}, "latest_only"


def held_index_changes(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)`; `how` is `held` or `not_held`. Never builds."""
    from api.services import index_changes as svc
    s = (sym or "").upper().strip()
    got = svc._held.peek()
    if not s or not isinstance(got, dict) or got.get("status") != "ok" or not isinstance(got.get("rows"), dict):
        return None, "not_held"
    rows = [c for i in svc.INDEXES for c in (got.get("rows") or {}).get(i) or []]
    rows = [c for c in rows if (c.get("added") or {}).get("sym") == s or (c.get("removed") or {}).get("sym") == s]
    rows.sort(key=lambda c: (c["date"], svc.INDEXES.index(c["index"]) * -1), reverse=True)
    return {"status": "ok", "index": "all", "sym": s, "read_at": got.get("read_at"), "source": svc.SOURCE,
            "check": got.get("check"), "indexes": got.get("indexes"), "total": len(rows),
            "cut": len(rows) > svc.SHOWN_CAP, "changes": rows[:svc.SHOWN_CAP]}, "held"
