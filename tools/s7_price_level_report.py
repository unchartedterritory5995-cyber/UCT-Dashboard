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
        "GATE-S7-PRICE-LEVEL - dark comparison, forward-only",
        "store: %s" % db_path,
        "",
        "NON-VACUITY CONTROL",
        "  predicates seen ....... %d" % rep["predicates"],
        "  comparison spans ...... %d" % rep["spans"],
        "  recorded outcomes ..... %d" % rep["observed"],
    ]

    if rep["predicates"] == 0:
        out += ["", "NO DATA. The store holds no comparison spans at all.",
                "This is NOT 'they agree' - nothing was ever compared. Check that",
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
            out.append("      -> anchors rewritten %dx - the pre-move spans are in "
                       "not-comparable BY DESIGN, never counted as agreement"
                       % d["anchor_version"])
        if d["level_kind"] == "trendline":
            out.append("      -> TRENDLINE: its level moves between ticks by "
                       "construction, so its disagreements are not the same fact "
                       "as a fixed level's")

    out += ["", "VERDICT GATE", "  five full trading sessions of forward data, per predicate."]
    out.append("  status: %s" % ("READY - every predicate has five sessions"
                                 if ready_all else
                                 "NOT READY - do not read a flip decision out of this yet"))

    out += ["",
            "!! KNOWN BLIND SPOT, and it points the flattering way.",
            "  The legacy path is ONE-SHOT (_trigger_alert sets is_active = 0) and the",
            "  projection reads only active rows, so once legacy fires, that row leaves",
            "  the comparison. This report sees the FIRST divergence per predicate and",
            "  CANNOT see a second crossing. A new-only of 0 is therefore not evidence",
            "  that persistent-vs-one-shot is harmless - it is a thing we cannot observe."]
    return "\n".join(out)


def _in_window() -> tuple[bool, str]:
    """Is NOW inside the sweep's cron window (mon-fri 09:00-16:59 ET)?

    Returns the reason as text either way, so the caller never restates the
    schedule and the two copies cannot drift.
    """
    try:
        from zoneinfo import ZoneInfo
        import datetime as _dt
        now = _dt.datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        # Never guess QUIET: an unresolvable clock must not silence a real stall.
        return (True, "could not resolve ET -- assuming inside the window")
    stamp = now.strftime("%a %H:%M ET")
    if now.weekday() >= 5:
        return (False, "it is %s" % stamp)
    if not (9 <= now.hour <= 16):
        return (False, "it is %s, outside 09:00-16:59" % stamp)
    return (True, stamp)


def ticking_event_proximity(db_path: str) -> tuple[str, int]:
    """The same liveness question for the SECOND dark run.

    ⛔ Its cadence is different and the staleness bound must follow it, not be
    copied. price-level ticks every minute (180 s is two missed ticks);
    event-proximity ticks TWICE A DAY at 07:05 and 18:05 ET, so a 180 s bound
    would report a healthy sweep as stalled every single time it was run. The
    bound here is ~26 h: longer than the longest legitimate gap (Friday evening
    to Monday morning is longer still, which is why the weekend check below
    excuses it rather than this number stretching to cover it).
    """
    import time as _t
    beat = None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            r = conn.execute("SELECT * FROM event_proximity_sweep_heartbeat "
                             "WHERE id = 1").fetchone()
            beat = dict(r) if r else None
        finally:
            conn.close()
    except sqlite3.OperationalError:
        beat = None

    if beat is None:
        inside, when = _in_window()
        if not inside:
            return ("EVENT-PROXIMITY  n/a -- %s, and its slots are 07:05 / 18:05 ET "
                    "on weekdays. No heartbeat yet is EXPECTED." % when, 0)
        return ("EVENT-PROXIMITY  NO  -- no heartbeat, and it IS a weekday (%s).\n"
                "  Check ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED=1 and the boot "
                "line 'S7 event-proximity DARK comparison ENABLED'." % when, 1)

    age = _t.time() - float(beat["last_tick"])
    alive = age < 26 * 3600
    lines = [
        "EVENT-PROXIMITY  %s -- last tick %.1fh ago, %d ticks total"
        % ("YES" if alive else "NO ", age / 3600.0, int(beat["ticks"])),
        "  projected %d, reschedules %d"
        % (int(beat["projected"]), int(beat["reschedules"])),
    ]
    if not alive:
        lines.append("  STALLED -- it has missed at least one slot. Check the web log "
                     "for 'event-proximity DARK sweep failed'.")
    if int(beat["projected"]) == 0:
        lines.append("  ! projected=0 -- no admin account's My Stocks intersected the "
                     "day's reporters. Healthy, but comparing NOBODY.")
    return ("\n".join(lines), 0 if alive else 1)


def ticking(db_path: str) -> tuple[str, int]:
    """The Monday-morning question, answered in one line: IS IT TICKING AND
    WRITING ROWS?

    ⛔ TWO FACTS, NOT ONE, because they fail separately and the fix differs:
      * TICKING  — the heartbeat's wall-clock age. A sweep that died at 09:01
        leaves a store that looks, at 15:00, exactly like one that never
        stopped, so age is the only thing that can tell them apart.
      * WRITING  — spans and recorded outcomes. A sweep can tick perfectly and
        write nothing (no admin alert, or no price reaching it), and that is a
        different problem with a different cause.

    ⛔ NEITHER IS INFERRED FROM THE OTHER, and "no rows yet" is never reported
    as a fault: on Monday at 09:05 the honest answer is usually
    "ticking, 0 outcome rows" — nobody's line has been crossed yet.
    """
    import time as _t
    beat = None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            r = conn.execute("SELECT * FROM price_level_sweep_heartbeat "
                             "WHERE id = 1").fetchone()
            beat = dict(r) if r else None
        finally:
            conn.close()
    except sqlite3.OperationalError:
        beat = None          # table absent = the sweep has never run once

    try:
        rep = build(db_path)
    except sqlite3.OperationalError:
        rep = {"predicates": 0, "spans": 0, "observed": 0}

    if beat is None:
        # THE WEEKEND CASE. "Outside the sweep window" and "armed but broken"
        # leave an IDENTICAL store and call for OPPOSITE actions -- wait, vs
        # investigate. Reporting the first as the second is a false alarm, and a
        # liveness command that cries wolf gets ignored, which is worse than not
        # having one.
        inside, when = _in_window()
        if not inside:
            return ("TICKING: n/a -- %s, and the sweep only runs weekdays "
                    "09:00-16:59 ET.\n"
                    "  No heartbeat yet is EXPECTED here, not a fault. Re-run "
                    "after Monday's open." % when, 0)
        return ("TICKING: NO  -- no heartbeat row at all, and it IS inside the "
                "window (%s).\n"
                "  The sweep should have stamped within the last minute. Check "
                "ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED=1, the boot line "
                "'S7 price-level DARK comparison ENABLED', and the web log for "
                "'price-level DARK sweep failed'." % when, 1)

    age = _t.time() - float(beat["last_tick"])
    # The sweep runs every minute inside the window; 3 minutes is two missed
    # ticks, which is a stall rather than a slow one.
    alive = age < 180
    verdict = "YES" if alive else "NO "
    lines = [
        "TICKING: %s -- last tick %.0fs ago, %d ticks total"
        % (verdict, age, int(beat["ticks"])),
        "  WRITING: %d spans, %d recorded outcomes, %d predicates projected"
        % (rep["spans"], rep["observed"], int(beat["projected"])),
        "  priced %d, no_price %s" % (int(beat["priced"]), beat["no_price"]),
    ]
    if alive and rep["observed"] == 0:
        lines.append("  (0 outcome rows is NORMAL early -- it means nobody's line has "
                     "been crossed yet, not that the sweep is broken)")
    if not alive:
        lines.append("  STALLED. The sweep wrote once and stopped, which looks "
                     "identical to a healthy store without this age. Check the web "
                     "logs for 'price-level DARK sweep failed'.")
    if int(beat["projected"]) == 0:
        lines.append("  ! projected=0 -- no ACTIVE watchlist_alerts row belongs to an "
                     "admin account, so there is nothing to compare. Arm one.")
    return ("\n".join(lines), 0 if alive else 1)


def main() -> int:
    # ⛔ A console that cannot encode one character must not kill the report.
    # `tools/flag_ledger_audit.py` reported "could not enumerate the project's
    # services" for two days because cp1252 killed a reader thread on the first
    # box-drawing byte -- which reads as an auth problem, not an encoding one.
    # The rendered output above is ASCII by construction; this is the backstop
    # for anything that reaches stdout another way.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", help="path to alert_taxonomy.db (default: $ALERT_TAXONOMY_DB_PATH "
                                 "or $DATA_DIR/alert_taxonomy.db or /data/alert_taxonomy.db)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--ticking", action="store_true",
                    help="one-line liveness answer: is the sweep ticking and writing rows?")
    ap.add_argument("--self-check", action="store_true",
                    help="prove this report can distinguish 'no data' from 'agreement'")
    args = ap.parse_args()

    if args.self_check:
        return _self_check()

    db = _store_path(args.db)
    if not os.path.exists(db):
        print("NO STORE AT %s - the dark run has not written anything here.\n"
              "This is NOT agreement. Check the path and the sweep flag." % db)
        return 2
    if args.ticking:
        # ⭐ ONE COMMAND, BOTH DARK RUNS. Two commands would mean a Monday where
        # somebody checks one and assumes the other, and the second is the one
        # with the twice-a-day cadence nobody has a feel for yet.
        t1, c1 = ticking(db)
        t2, c2 = ticking_event_proximity(db)
        print("PRICE-LEVEL      " + t1.replace("TICKING: ", "", 1))
        print(t2)
        # ⛔ The worse of the two wins. A green overall line beside one stalled
        # sweep is exactly the reassurance that stops anyone reading further.
        return max(c1, c2)
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

    print("self-check: %s" % ("PASS - the report distinguishes no-data from agreement"
                              if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
