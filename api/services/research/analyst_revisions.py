"""TERM-073 (FB-A4-01) -- the member half: what changed in the nightly analyst pass.

`analyst_pass` has retained every nightly observation since 2026-09-28
(`analyst_timeline`, append-only). This turns one ticker's retained rows into the
answer FB-A4-01 names: "the day it holds two dated snapshots it can answer what
changed".

⛔ THE METHOD SHIPS WITH THE NUMBER (PROD-C5). Every answer carries its window
(first and last pass date), how many nightly snapshots it read, the source, and
the contributor set -- and the contributor set is NOT retained by the pass (it
keeps consensus, target, 30-day up/downgrades and EPS growth, not the analyst
count). So `contributors` is `None` with a sentence saying so, never a guess.

⛔ AN UNCHANGED NIGHT IS NOT A REVISION. Two identical snapshots answer
`no_revision`, never a flat line that implies coverage it does not have.

⛔ DARK behind `ANALYST_REVISIONS_ENABLED` (read per call, unset = OFF).
"""
from __future__ import annotations

import os

FLAG = "ANALYST_REVISIONS_ENABLED"

SOURCE = "UCT nightly analyst pass (FMP grades, consensus and price target)"
CONTRIBUTORS_NOTE = ("The nightly pass does not retain the number of contributing "
                     "analysts, so no contributor count is shown.")

#: The fields the timeline retains, with the member-facing label for each.
FIELD_LABELS = {
    "consensus": "Consensus rating",
    "pt_target": "Consensus price target",
    "upgrades_30d": "Upgrades (30d)",
    "downgrades_30d": "Downgrades (30d)",
    "eps_next_y_growth": "EPS growth, next year",
}


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF (an enablement gate on a dark surface)."""
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes", "on")


def normalize_ticker(ticker: str) -> str:
    return (ticker or "").upper().strip()


def revision_history(ticker: str, *, read_fn=None, revisions_fn=None) -> dict:
    """`{ticker, status, window, observations, revisions, fields, source,
    contributors, contributors_note}`.

    status:
      `no_history`   0 or 1 retained snapshot -- nothing to compare yet
      `no_revision`  2+ snapshots, every retained field identical throughout
      `revised`      at least one field changed between consecutive snapshots
    """
    from api.services.screener import analyst_pass

    read_fn = read_fn or analyst_pass.read_timeline
    revisions_fn = revisions_fn or analyst_pass.revisions
    sym = normalize_ticker(ticker)
    timeline = read_fn(sym) if sym else []
    ordered = sorted(timeline, key=lambda r: r["fetched_at"])
    window = ({"first": ordered[0]["pass_date"], "last": ordered[-1]["pass_date"]}
              if ordered else None)
    out = {
        "ticker": sym,
        "window": window,
        "observations": len(ordered),
        "revisions": [],
        "fields": FIELD_LABELS,
        "source": SOURCE,
        "contributors": None,
        "contributors_note": CONTRIBUTORS_NOTE,
    }
    if len(ordered) < 2:
        out["status"] = "no_history"
        return out
    revs = revisions_fn(ordered)
    out["revisions"] = [
        {"from_date": r["from_date"], "to_date": r["to_date"],
         "changes": {f: {"from": old, "to": new} for f, (old, new) in r["changes"].items()}}
        for r in revs
    ]
    out["status"] = "revised" if revs else "no_revision"
    return out
