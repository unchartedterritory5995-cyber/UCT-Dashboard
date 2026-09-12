#!/usr/bin/env python
"""GATE-S7-PRICE-LEVEL — the comparison report the owner reads before the flip.

    python tools/s7_price_level_report.py

READ-ONLY. It opens the alert-taxonomy store, reads the forward-only comparison
spans, and prints per predicate: **agreed / new-only / legacy-only /
not-comparable**, the sessions covered, and whether a verdict may be shown at
all.

──────────────────────────────────────────────────────────────────────────────
⛔ THE FOUR OUTCOMES ARE NEVER COLLAPSED INTO A PASS RATE
──────────────────────────────────────────────────────────────────────────────

A single percentage would answer the wrong question. `legacy_only` and
`new_only` are DIFFERENT DEFECTS pointing at different members: the first is an
alert somebody loses at the flip, the second is one they start getting twice.
`not_comparable` is neither — it is span time we deliberately refuse to score,
and a report that folded it into the denominator would make moving a trendline
look like agreement.

⛔ AND "NOT ENOUGH DATA YET" IS NOT "THEY AGREE". `verdict_ready` is printed as
its own line, never baked into a number. Below five full trading sessions this
report says so in words and declines to summarise.

──────────────────────────────────────────────────────────────────────────────
⚠️ THE NON-VACUITY CONTROL, AND WHY IT IS THE FIRST THING PRINTED
──────────────────────────────────────────────────────────────────────────────

An empty comparison store prints four zeroes per predicate and reads like
perfect agreement. So the report leads with what it actually observed — how many
predicates, how many spans, how many recorded ticks — and **refuses to print a
verdict at all when nothing was observed**, saying `NO DATA` instead. A dark run
that never ran and a dark run that found no disagreement are different facts.

──────────────────────────────────────────────────────────────────────────────
⚠️ ONE KNOWN BLIND SPOT, PRINTED EVERY TIME
──────────────────────────────────────────────────────────────────────────────

The legacy path is ONE-SHOT: `_trigger_alert` sets `is_active = 0`, and the
projection reads only active rows. So the moment legacy fires, the row leaves
the projection and the comparison goes quiet for it. This report therefore sees
the FIRST divergence per predicate and cannot see a second crossing at all — a
`new_only` of zero is **not** evidence that the persistent-vs-one-shot
difference is harmless. That sentence is printed with the totals so it cannot be
read past. Rail: `test_KNOWN_LIMIT_the_one_shot_divergence_is_invisible_to_a_projection`.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

MIN_SESSIONS = 5          # mirrored from price_level_compare, re-read below


def _store_path(explicit: str | None) -> str:
    if explicit:
        return explicit
    env = os.environ.get("ALERT_TAXONOMY_DB_PATH")
    if env:
        return env
    data = os.environ.get("DATA_DIR", "/data")
    return os.path.join(data, "alert_taxonomy.db")


def _rows(db_path: str) -> list[dict]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM price_level_comparison_spans ORDER BY predicate_id, id")]
    finally:
        conn.close()


def build(db_path: str) -> dict:
    rows = _rows(db_path)
    per: dict[str, dict] = {}
    for r in rows:
        pid = r["predicate_id"]
        d = per.setdefault(pid, {"agreed": 0, "new_only": 0, "legacy_only": 0,
                                 "not_comparable": 0, "spans": 0, "sessions": set(),
                                 "anchor_version": 0, "level_kind": None})
        for k in ("agreed", "new_only", "legacy_only", "not_comparable"):
            d[k] += int(r[k] or 0)
        d["spans"] += 1
        d["sessions"] |= set(json.loads(r["sessions"] or "[]"))
        d["anchor_version"] = max(d["anchor_version"], int(r["anchor_version"] or 0))
        twin = json.loads(r["twin"] or "{}") or {}
        d["level_kind"] = twin.get("level_kind") or d["level_kind"]

    observed = sum(d[k] for d in per.values()
                   for k in ("agreed", "new_only", "legacy_only", "not_comparable"))
    return {"per": per, "predicates": len(per), "spans": len(rows), "observed": observed}


def render(rep: dict, db_path: str) -> str:
    out = [
        "GATE-S7-PRICE-LEVEL — dark comparison, forward-only",
        "store: %s" % db_path,
        "",
        "NON-VACUITY CONTROL",
        "  predicates seen ....... %d" % rep["predicates"],
        "  comparison spans ...... %d" % rep["spans"],
        "  recorded outcomes ..... %d" % rep["observed"],
    ]

    if rep["predicates"] == 0:
        out += ["", "NO DATA. The store holds no comparison spans at all.",
                "This is NOT 'they agree' — nothing was ever compared. Check that",
                "ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED=1 on the web service and",
                "that the sweep is printing '[alert_taxonomy] price-level DARK sweep'."]
        return "\n".join(out)

    if rep["observed"] == 0:
        out += ["", "SPANS EXIST BUT NOTHING WAS EVER RECORDED. Either no admin alert's",
                "price moved through its level in the window, or no price reached the",
                "sweep (check the no_price list in the sweep log). Still NOT agreement."]

    out += ["", "PER PREDICATE  (legacy watchlist_alerts row id after 'legacy:')", ""]
    out.append("  %-26s %7s %9s %11s %15s %8s %s"
               % ("predicate", "agreed", "new-only", "legacy-only",
                  "not-comparable", "sessions", "verdict"))

    ready_all = True
    for pid in sorted(rep["per"]):
        d = rep["per"][pid]
        n = len(d["sessions"])
        ready = n >= MIN_SESSIONS
        ready_all = ready_all and ready
        out.append("  %-26s %7d %9d %11d %15d %8d %s"
                   % (pid[:26], d["agreed"], d["new_only"], d["legacy_only"],
                      d["not_comparable"], n,
                      "ready" if ready else "NOT READY (%d/%d)" % (n, MIN_SESSIONS)))
        if d["anchor_version"]:
            out.append("      ↳ anchors rewritten %d× — the pre-move spans are in "
                       "not-comparable BY DESIGN, never counted as agreement"
                       % d["anchor_version"])
        if d["level_kind"] == "trendline":
            out.append("      ↳ TRENDLINE: its level moves between ticks by "
                       "construction, so its disagreements are not the same fact "
                       "as a fixed level's")

    out += ["", "VERDICT GATE", "  five full trading sessions of forward data, per predicate."]
    out.append("  status: %s" % ("READY — every predicate has five sessions"
                                 if ready_all else
                                 "NOT READY — do not read a flip decision out of this yet"))

    out += ["",
            "⚠️ KNOWN BLIND SPOT, and it points the flattering way.",
            "  The legacy path is ONE-SHOT (_trigger_alert sets is_active = 0) and the",
            "  projection reads only active rows, so once legacy fires, that row leaves",
            "  the comparison. This report sees the FIRST divergence per predicate and",
            "  CANNOT see a second crossing. A new-only of 0 is therefore not evidence",
            "  that persistent-vs-one-shot is harmless — it is a thing we cannot observe."]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", help="path to alert_taxonomy.db (default: $ALERT_TAXONOMY_DB_PATH "
                                 "or $DATA_DIR/alert_taxonomy.db or /data/alert_taxonomy.db)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--self-check", action="store_true",
                    help="prove this report can distinguish 'no data' from 'agreement'")
    args = ap.parse_args()

    if args.self_check:
        return _self_check()

    db = _store_path(args.db)
    if not os.path.exists(db):
        print("NO STORE AT %s — the dark run has not written anything here.\n"
              "This is NOT agreement. Check the path and the sweep flag." % db)
        return 2
    rep = build(db)
    if args.json:
        rep["per"] = {k: {**v, "sessions": sorted(v["sessions"])}
                      for k, v in rep["per"].items()}
        print(json.dumps(rep, indent=2))
    else:
        print(render(rep, db))
    return 0


def _self_check() -> int:
    """⛔ A REPORT NOBODY HAS SEEN FAIL IS NOT A REPORT. Builds two throwaway
    stores — one empty, one with a real disagreement — and asserts the output
    tells them apart."""
    import tempfile
    ok = True
    with tempfile.TemporaryDirectory() as d:
        empty = os.path.join(d, "empty.db")
        conn = sqlite3.connect(empty)
        conn.execute("CREATE TABLE price_level_comparison_spans ("
                     "id INTEGER PRIMARY KEY, predicate_id TEXT, anchor_version INTEGER, "
                     "opened_at REAL, closed_at REAL, close_reason TEXT, twin TEXT, "
                     "prev_legacy REAL, sessions TEXT, agreed INTEGER DEFAULT 0, "
                     "new_only INTEGER DEFAULT 0, legacy_only INTEGER DEFAULT 0, "
                     "not_comparable INTEGER DEFAULT 0)")
        conn.commit(); conn.close()
        text = render(build(empty), empty)
        if "NO DATA" not in text:
            print("SELF-CHECK FAIL: an empty store did not say NO DATA"); ok = False

        real = os.path.join(d, "real.db")
        conn = sqlite3.connect(real)
        conn.execute("CREATE TABLE price_level_comparison_spans ("
                     "id INTEGER PRIMARY KEY, predicate_id TEXT, anchor_version INTEGER, "
                     "opened_at REAL, closed_at REAL, close_reason TEXT, twin TEXT, "
                     "prev_legacy REAL, sessions TEXT, agreed INTEGER DEFAULT 0, "
                     "new_only INTEGER DEFAULT 0, legacy_only INTEGER DEFAULT 0, "
                     "not_comparable INTEGER DEFAULT 0)")
        conn.execute("INSERT INTO price_level_comparison_spans "
                     "(predicate_id, anchor_version, opened_at, twin, sessions, "
                     " agreed, new_only, legacy_only, not_comparable) "
                     "VALUES ('legacy:a1', 1, 0, '{\"level_kind\":\"trendline\"}', "
                     "'[\"d1\",\"d2\"]', 3, 0, 2, 4)")
        conn.commit(); conn.close()
        text = render(build(real), real)
        for needle in ("legacy:a1", "NOT READY", "anchors rewritten", "TRENDLINE"):
            if needle not in text:
                print("SELF-CHECK FAIL: missing %r in the populated report" % needle)
                ok = False
        if "NO DATA" in text:
            print("SELF-CHECK FAIL: a populated store reported NO DATA"); ok = False

    print("self-check: %s" % ("PASS — the report distinguishes no-data from agreement"
                              if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
