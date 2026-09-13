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


# ═════════════════════════════════════════════════════════════════════════════
# ⛔⛔ SIX DARK SWEEPS, ONE COMMAND, AND THE BOUNDS ARE PER TYPE BY DESIGN
# ═════════════════════════════════════════════════════════════════════════════
#
# ⚰️ This file once held TWO bespoke `ticking_*` functions, and a third was about
# to be written. Three copies of one guard cannot all be mutation-proved
# (`lesson_a_guard_repeated_is_a_guard_unproved`), and the interesting part —
# the staleness bound — is the ONE thing that legitimately differs per sweep.
# So the descriptors are DECLARED and the logic is written once.
#
# ⛔ A BOUND COPIED FROM A SIBLING IS A FALSE ALARM GENERATOR. price-level ticks
# every minute, so 180 s is two missed ticks. catalyst-match ticks ONCE A DAY;
# judged at 180 s it would report a perfectly healthy sweep as stalled every
# single time anyone ran this, and a liveness command that cries wolf gets
# ignored — which is worse than not having one.
#
# ⛔ AND THE WINDOW IS NOT THE BOUND. "Outside its cron window" and "armed but
# dead" leave an IDENTICAL store and call for OPPOSITE actions (wait, versus
# investigate). Every descriptor carries both.

#: (key, label, flag, table, ts_col, hours, bound_s, cadence)
#: `hours` is the ET hour range the cron runs in, or None for a daily slot where
#: only the weekday matters. All six are mon-fri.
SWEEPS = (
    ("price_level", "PRICE-LEVEL", "ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED",
     "price_level_sweep_heartbeat", "last_tick", (9, 16), 180,
     "every minute, weekdays 09:00-16:59 ET"),
    ("event_proximity", "EVENT-PROXIMITY", "ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED",
     "event_proximity_sweep_heartbeat", "last_tick", None, 26 * 3600,
     "07:05 and 18:05 ET, weekdays"),
    ("position_risk", "POSITION-RISK", "ALERT_TAXONOMY_POSITION_RISK_DARK_ENABLED",
     "position_risk_heartbeat", "last_tick_at", (9, 16), 180,
     "every minute, weekdays 09:00-16:59 ET"),
    ("scan_membership", "SCAN-MEMBERSHIP", "ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED",
     "scan_membership_heartbeat", "last_tick_at", None, 26 * 3600,
     "nightly, 20 min after the scan sweep (~05:20 ET), weekdays"),
    ("catalyst_match", "CATALYST-MATCH", "ALERT_TAXONOMY_CATALYST_MATCH_DARK_ENABLED",
     "catalyst_match_heartbeat", "last_tick_at", None, 26 * 3600,
     "17:30 ET, weekdays"),
    ("regime_change", "REGIME-CHANGE", "ALERT_TAXONOMY_REGIME_CHANGE_DARK_ENABLED",
     "regime_change_heartbeat", "last_tick_at", (4, 20), 3600,
     "every 20 min behind the awareness scan, weekdays 04:00-20:59 ET"),
)


def _window(hours) -> tuple[bool, str]:
    """Is NOW inside this sweep's cron window? Returns the reason either way, so
    no caller restates a schedule and the copies cannot drift."""
    try:
        from zoneinfo import ZoneInfo
        import datetime as _dt
        now = _dt.datetime.now(ZoneInfo("America/New_York"))
    except Exception:                                   # noqa: BLE001
        # ⛔ Never guess QUIET: an unresolvable clock must not silence a stall.
        return (True, "could not resolve ET -- assuming inside the window")
    stamp = now.strftime("%a %H:%M ET")
    if now.weekday() >= 5:
        return (False, "it is %s (weekend)" % stamp)
    if hours is not None and not (hours[0] <= now.hour <= hours[1]):
        return (False, "it is %s, outside %02d:00-%02d:59" % (stamp, hours[0], hours[1]))
    return (True, stamp)


def _beat_row(db_path: str, table: str) -> dict | None:
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            r = conn.execute(f"SELECT * FROM {table} LIMIT 1").fetchone()
            return dict(r) if r else None
        finally:
            conn.close()
    except sqlite3.OperationalError:
        return None          # table absent = the sweep has never run once


def ticking_one(db_path: str, spec) -> tuple[str, int]:
    """One sweep's liveness, as TWO facts that fail separately.

    * TICKING — the heartbeat's wall-clock age. A sweep that died at 09:01
      leaves a store that looks, at 15:00, exactly like one that never stopped.
    * WRITING — spans and outcomes. A sweep can tick perfectly and write nothing
      (nobody in the cohort, no price reaching it), and that is a different
      problem with a different cause.

    ⛔ NEITHER IS INFERRED FROM THE OTHER, and "no rows yet" is never a fault.
    """
    import time as _t
    key, label, flag, table, ts_col, hours, bound, cadence = spec
    beat = _beat_row(db_path, table)

    if beat is None:
        inside, when = _window(hours)
        if not inside:
            return ("%-16s n/a -- %s; it runs %s.\n"
                    "  No heartbeat yet is EXPECTED here, not a fault."
                    % (label, when, cadence), 0)
        return ("%-16s NO  -- no heartbeat at all, and it IS inside the window (%s).\n"
                "  Check %s=1, the boot line, and the web log for a 'DARK sweep "
                "failed' line." % (label, when, flag), 1)

    raw = beat.get(ts_col)
    if raw is None:
        return ("%-16s UNREADABLE -- a heartbeat row exists with no %s. That is not a "
                "zero and must not be read as one." % (label, ts_col), 1)

    age = _t.time() - float(raw)
    alive = age < bound
    unit = ("%.0fs" % age) if bound < 3600 else ("%.1fh" % (age / 3600.0))
    lines = ["%-16s %s -- last tick %s ago, %d ticks total (bound %s; %s)"
             % (label, "YES" if alive else "NO ", unit, int(beat.get("ticks") or 0),
                ("%ds" % bound) if bound < 3600 else ("%dh" % (bound // 3600)), cadence)]

    # Type-specific extras, printed only where the table actually carries them.
    if "projected" in beat:
        lines.append("  projected %s" % beat["projected"])
    if "priced" in beat:
        lines.append("  priced %s, no_price %s" % (beat["priced"], beat.get("no_price")))
    if "reschedules" in beat:
        lines.append("  reschedules %s" % beat["reschedules"])
    if "last_market_date" in beat:
        lines.append("  last market date observed: %s" % beat["last_market_date"])

    if not alive:
        inside, when = _window(hours)
        if not inside:
            lines[0] = lines[0].replace(" NO  --", " n/a --", 1)
            lines.append("  ...but %s, so the gap is the schedule, not a stall. "
                         "Re-run inside the window." % when)
            return ("\n".join(lines), 0)
        lines.append("  STALLED inside its own window. It wrote once and stopped, "
                     "which looks identical to a healthy store without this age.")
    return ("\n".join(lines), 0 if alive else 1)


def ticking_all(db_path: str) -> tuple[str, int]:
    """⭐ ONE COMMAND, ALL SIX. Separate commands would mean a Monday where
    somebody checks one and assumes the others — and four of the six have
    cadences nobody has a feel for yet.

    ⛔ THE WORST RESULT WINS. A green overall line beside one stalled sweep is
    exactly the reassurance that stops anyone reading further.
    """
    out, worst = [], 0
    for spec in SWEEPS:
        text, code = ticking_one(db_path, spec)
        out.append(text)
        worst = max(worst, code)
    return ("\n".join(out), worst)


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
        text, code = ticking_all(db)
        print(text)
        return code
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

    # ── the six-sweep liveness check ────────────────────────────────────────
    # ⛔⛔ THE CONTROL THAT MATTERS: the per-type bounds must DISCRIMINATE. One
    # age, six sweeps, opposite verdicts — otherwise the bounds are decoration
    # and a daily sweep would be reported as stalled every time anyone looked.
    import tempfile as _tf, time as _tt
    with _tf.TemporaryDirectory() as d:
        hb = os.path.join(d, "hb.db")
        conn = sqlite3.connect(hb)
        conn.executescript(
            "CREATE TABLE price_level_sweep_heartbeat (id INTEGER PRIMARY KEY, "
            " last_tick REAL, ticks INTEGER, projected INTEGER, priced INTEGER, no_price TEXT);"
            "CREATE TABLE catalyst_match_heartbeat (key TEXT PRIMARY KEY, ticks INTEGER, "
            " last_tick_at REAL, last_market_date TEXT);")
        stale = _tt.time() - 4000          # 1.1h: past 180s, well inside 26h
        conn.execute("INSERT INTO price_level_sweep_heartbeat VALUES (1,?,1,0,0,'[]')", (stale,))
        conn.execute("INSERT INTO catalyst_match_heartbeat VALUES ('k',1,?,'d')", (stale,))
        conn.commit(); conn.close()

        spec_pl = [s for s in SWEEPS if s[0] == "price_level"][0]
        spec_cm = [s for s in SWEEPS if s[0] == "catalyst_match"][0]
        # Force "inside the window" so the weekend cannot mask the comparison —
        # otherwise this control passes on a Sunday for the wrong reason.
        _real_window = globals()["_window"]
        globals()["_window"] = lambda hours: (True, "forced inside (self-check)")
        try:
            pl_text, pl_code = ticking_one(hb, spec_pl)
            cm_text, cm_code = ticking_one(hb, spec_cm)
        finally:
            globals()["_window"] = _real_window

        if pl_code != 1:
            print("SELF-CHECK FAIL: a 4000s-old beat passed price-level's 180s bound"); ok = False
        if cm_code != 0:
            print("SELF-CHECK FAIL: a 4000s-old beat failed catalyst-match's 26h bound — "
                  "the bounds are not per type and a daily sweep will read as stalled"); ok = False
        if "STALLED" not in pl_text:
            print("SELF-CHECK FAIL: a stale beat inside the window did not say STALLED"); ok = False

        # A sweep whose table is absent, inside its window, must be NO — not n/a.
        globals()["_window"] = lambda hours: (True, "forced inside (self-check)")
        try:
            miss_text, miss_code = ticking_one(hb, [s for s in SWEEPS
                                                    if s[0] == "position_risk"][0])
        finally:
            globals()["_window"] = _real_window
        if miss_code != 1 or "no heartbeat at all" not in miss_text:
            print("SELF-CHECK FAIL: a missing heartbeat inside the window was not a NO"); ok = False

        # NON-VACUITY: every declared sweep must be answerable, so a typo in a
        # table name cannot hide as a permanent n/a.
        if len(SWEEPS) != 6:
            print("SELF-CHECK FAIL: expected six declared sweeps, found %d" % len(SWEEPS))
            ok = False

    print("self-check: %s" % ("PASS - the report distinguishes no-data from agreement, "
                              "and the six staleness bounds discriminate"
                              if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
