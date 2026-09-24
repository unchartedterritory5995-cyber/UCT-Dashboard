"""PIT UCT PROVENANCE GATE — was this membership snapshot actually KNOWN at its session?

Canonical UCT is the membership we can prove was known at the session; when provenance fails
the correct value is NO canonical value (a gap). No date-specific exceptions: every live-period
row (session >= live_from) is classified by the same objective predicates on the read-only
export of production `breadth_snapshots` (date, created_at, metrics.universe_list, metrics._healed):

  LATE_AFTER_NEXT_OPEN   created_at >= the next weekday's 13:30Z open: the list may carry hindsight
  HINDSIGHT_RERUN        list byte-identical to the NEXT session's list AND written after it
  HEALED_COPY            a `_healed` (server self-heal) row whose list is identical to an EARLIER
                         session's list — a copied substitute, not a capture
  SELF_HEAL_RECONSTRUCTION  a `_healed` row whose list was not the collector's (< 99 % of names carry
                         the collector's per-name pct) — rebuilt server-side

NOT grounds for rejection on their own (legitimate collector behaviour, regression-railed):
  * a list identical to the previous session's, written on time (the collector falls back to the
    last available provider snapshot: 08-13/08-14, 09-04/09-08);
  * partial pct coverage on an un-healed collector row (06-16, 07-27);
  * a `_healed` row that preserved the collector's list (the self-heal recomputes scalars and keeps
    drill lists).
"""
import datetime as dt

PCT_COLLECTOR_SHARE = 0.99


def next_open(d: str) -> str:
    x = dt.date.fromisoformat(d) + dt.timedelta(days=1)
    while x.weekday() >= 5:
        x += dt.timedelta(days=1)
    return x.isoformat() + " 13:30:00"


def classify(export: dict, live_from: str) -> dict:
    """{session: {"pit": bool, "reasons": [...], "evidence": {...}}} for every session >= live_from."""
    order = sorted(d for d in export if d >= live_from)
    out = {}
    for i, d in enumerate(order):
        x = export[d]
        nxt = order[i + 1] if i + 1 < len(order) else None
        earlier_same = [o for o in order[:i] if export[o]["sha256"] == x["sha256"]]
        share = (x["pct_populated"] / x["items"]) if x.get("items") else 0.0
        r = []
        if x["created_at"] >= next_open(d):
            r.append("LATE_AFTER_NEXT_OPEN: written %s, next open %s" % (x["created_at"], next_open(d)))
        if nxt and export[nxt]["sha256"] == x["sha256"] and x["created_at"] > export[nxt]["created_at"]:
            r.append("HINDSIGHT_RERUN: list identical to next session %s and written after it" % nxt)
        if x.get("healed") and earlier_same:
            r.append("HEALED_COPY: self-heal row, list identical to earlier session %s" % earlier_same[-1])
        if x.get("healed") and share < PCT_COLLECTOR_SHARE:
            r.append("SELF_HEAL_RECONSTRUCTION: self-heal row, collector pct on %d/%d names"
                     % (x["pct_populated"], x["items"]))
        out[d] = {"pit": not r, "reasons": r,
                  "evidence": {"created_at": x["created_at"], "n": x["n"], "universe_count": x.get("universe_count"),
                               "healed": bool(x.get("healed")), "pct_share": round(share, 4),
                               "same_list_as": earlier_same[-1:] or None, "next_open": next_open(d)}}
    return out
