"""ONE command: is any Terminal-Next gate READY, and what would the owner sign?

Every data-blocked gate reads its OWN live criterion here. Per gate it prints
READY / NOT READY / UNREADABLE with the numbers behind the verdict, and — when
READY — the exact authorization line to paste.

⛔⛔ UNREADABLE IS A THIRD STATE AND IT IS THE WHOLE POINT. A store that cannot
be opened must never print a zero. Four clean zeroes read like perfect agreement,
and this programme has caught that shape three times (the dual-compute ledger,
CoverageLine's not-computable, the forward-only comparison's not_comparable).
`--self-check` proves both directions: a synthetic READY fixture, and a missing
store printing UNREADABLE rather than 0.

⚠️ READ-ONLY. It opens stores, reads flags, and writes nothing anywhere.

    python tools/terminal_next_gate_check.py
    python tools/terminal_next_gate_check.py --self-check
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

READY, NOT_READY, UNREADABLE = "READY", "NOT READY", "UNREADABLE"


class Gate:
    """One gate's live criterion. `check()` returns (state, detail, sign_line)."""

    id = "?"
    what = "?"

    def check(self):                                    # pragma: no cover - base
        raise NotImplementedError


class D2CP3(Gate):
    id = "D2 CP3"
    what = "≥200 AGREED dual-compute rows spanning ≥1 full session, zero inequality"

    def check(self):
        try:
            from api.services.canonical import dual_sample_store as s
            g = s.gate_status()
        except Exception as e:                          # noqa: BLE001
            return UNREADABLE, f"could not read the store: {e}", None
        if not g.get("observed"):
            return UNREADABLE, g.get("why", "store unreadable"), None
        detail = (f"rows={g['rows']} agreed={g.get('agreed', 0)} "
                  f"disagreed={g['disagreed']} book_unavailable={g['book_unavailable']} "
                  f"covered_sessions={len(g['covered_sessions'])} | {g['why']}")
        if g.get("gate_met"):
            return READY, detail, (
                "SCOPE APPROVED:   D2 CP3 - migrate the reader off the legacy index onto "
                "the book, serving the BOOK value. The dual-compute stays on as the rail.")
        return NOT_READY, detail, None


class S7DarkRead(Gate):
    """price-level / event-proximity: five full sessions of dark run."""

    def __init__(self, type_id, flag, sessions_needed=5):
        self.id = f"S7 {type_id} dark read"
        self.type_id = type_id
        self.flag = flag
        self.sessions_needed = sessions_needed
        self.what = f"{sessions_needed} full trading sessions of forward-only comparison"

    def check(self):
        armed = os.environ.get(self.flag)
        if armed is None:
            return UNREADABLE, (
                f"{self.flag} is not visible from here — this must be read IN THE POD. "
                "An unset flag locally is not evidence the sweep is off in production."), None
        try:
            from api.services.alert_taxonomy import db as _db  # noqa: F401
        except Exception as e:                          # noqa: BLE001
            return UNREADABLE, f"taxonomy store unreachable: {e}", None
        # ⚰️ THE COUNT AND THE BOUNDS ARE DERIVED FROM THE SWEEP TABLE ITSELF.
        # This read "for ALL SIX armed dark sweeps" and hand-listed which bound
        # belonged to which type — it went stale the moment indicator-condition
        # became the seventh, in the same commit that added it. A hand-typed
        # count beside the source that owns it is this programme's most-repeated
        # defect, and a gate message is exactly where nobody re-checks it.
        try:
            import importlib.util as _ilu
            _s = _ilu.spec_from_file_location(
                "_sweeps", str(pathlib.Path(__file__).resolve().parent
                               / "s7_price_level_report.py"))
            _m = _ilu.module_from_spec(_s)
            _s.loader.exec_module(_m)
            _detail = ", ".join(
                "%s=%s" % (x[1], ("%ds" % x[6]) if x[6] < 3600 else ("%dh" % (x[6] // 3600)))
                for x in _m.SWEEPS)
            _n = len(_m.SWEEPS)
        except Exception as _e:                          # noqa: BLE001
            _detail, _n = "UNREADABLE (%s)" % _e, "?"
        return NOT_READY, (
            f"{self.flag}={armed}; session count and liveness are read by "
            f"tools/s7_price_level_report.py --ticking, which owns the staleness bounds "
            f"for all {_n} armed dark sweeps and derives them per type: {_detail}. "
            "⛔ They differ BY DESIGN — a 180s bound applied to a daily sweep reports a "
            "healthy run as stalled every time, and a liveness command that cries wolf "
            "gets ignored."), None


class S7CP3Unbuilt(Gate):
    """A CP3 that is authorized and NOT YET BUILT — not a data gate yet.

    ⚰️ THIS HELD FOUR TYPES UNTIL 2026-09-13. `scan-membership-change`,
    `regime-change`, `position-risk` and `catalyst-match` were all built, merged
    and ARMED that day, so each moved to `S7DarkRead` below. ⛔ The class stays
    because `indicator-condition` is still in this state and, more importantly,
    because the DISTINCTION is the point: "authorized but unbuilt" and "armed but
    no data yet" are different facts with different fixes, and collapsing them
    would let an unbuilt checkpoint read as a quiet dark run.
    """

    def __init__(self, type_id, depends=None):
        self.id = f"S7 {type_id} CP3"
        self.type_id = type_id
        self.depends = depends
        self.what = "the projection built, then its own dark read"

    def check(self):
        if self.depends:
            return NOT_READY, (
                f"AUTHORIZED 2026-09-12 but VOID until {self.depends} merges — "
                "the approval line carries the precondition"), None
        return NOT_READY, "AUTHORIZED 2026-09-12, NOT BUILT. No data to read yet.", None


GATES = [
    D2CP3(),
    # ⭐ SIX ARMED DARK READS as of 2026-09-13 16:00:29 UTC, all six flags set in
    # ONE pass so `web` rebuilt once, each verified by artifact (uptime reset,
    # in-PROCESS value, boot line in the live log).
    S7DarkRead("price-level", "ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED"),
    S7DarkRead("event-proximity", "ALERT_TAXONOMY_EVENT_PROXIMITY_DARK_ENABLED"),
    S7DarkRead("position-risk", "ALERT_TAXONOMY_POSITION_RISK_DARK_ENABLED"),
    S7DarkRead("scan-membership-change", "ALERT_TAXONOMY_SCAN_MEMBERSHIP_DARK_ENABLED"),
    S7DarkRead("catalyst-match", "ALERT_TAXONOMY_CATALYST_MATCH_DARK_ENABLED"),
    S7DarkRead("regime-change", "ALERT_TAXONOMY_REGIME_CHANGE_DARK_ENABLED"),
    # ⛔ THE SEVENTH IS STILL UNBUILT and its approval line is VOID until its
    # precondition merges — a different state from the six above, deliberately
    # not flattened into them.
    # ⚰️ WAS S7CP3Unbuilt(depends="D2 §9.5 CP1") until 2026-09-13. That
    # dependency is DISCHARGED: PRD-D2 §9.5 is signed as GATE-D2 CP4
    # (3257cc319) and merged (404b808c5), and CP3 is signed by its own
    # approval line 3 (4e8d3af5d). It is now a dark read like its siblings.
    S7DarkRead("indicator-condition", "ALERT_TAXONOMY_INDICATOR_CONDITION_DARK_ENABLED"),
]


def run(gates=None):
    gates = gates if gates is not None else GATES
    rows = []
    for g in gates:
        try:
            state, detail, line = g.check()
        except Exception as e:                          # noqa: BLE001
            state, detail, line = UNREADABLE, f"the check itself raised: {e}", None
        rows.append((g, state, detail, line))
    return rows


def report(rows) -> int:
    width = max(len(g.id) for g, *_ in rows)
    ready = [r for r in rows if r[1] == READY]
    unreadable = [r for r in rows if r[1] == UNREADABLE]
    print("=" * 78)
    print("TERMINAL-NEXT GATE CHECK")
    print("=" * 78)
    for g, state, detail, _line in rows:
        print(f"  {state:<11} {g.id:<{width}}  {detail}")
    print()
    print(f"  {len(ready)} READY · {len(rows) - len(ready) - len(unreadable)} NOT READY "
          f"· {len(unreadable)} UNREADABLE")
    print()
    if unreadable:
        print("  ⛔ UNREADABLE IS NOT ZERO. A store that cannot be opened tells you nothing")
        print("     about the population inside it. Fix the read before reading the number.")
        print()
    if ready:
        print("  ⭐ LINES TO SIGN:")
        for g, _s, _d, line in ready:
            print(f"\n  --- {g.id} ---\n  {line}")
    else:
        print("  Nothing is READY. No authorization line is owed.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()

    if a.self_check:
        ok = True

        class SyntheticReady(Gate):
            id, what = "SYNTHETIC", "a fixture that must read READY"

            def check(self):
                return READY, "rows=200 agreed=200 disagreed=0", "SCOPE APPROVED:   fixture"

        class MissingStore(Gate):
            id, what = "MISSING-STORE", "a store that cannot be opened"

            def check(self):
                raise RuntimeError("no such table")

        rows = run([SyntheticReady(), MissingStore()])
        states = {g.id: s for g, s, _d, _l in rows}
        if states.get("SYNTHETIC") != READY:
            print("  ⛔ a READY fixture did not read READY"); ok = False
        if states.get("MISSING-STORE") != UNREADABLE:
            print(f"  ⛔ a missing store read as {states.get('MISSING-STORE')!r}, "
                  "not UNREADABLE — this is the zero-that-looks-clean defect"); ok = False
        detail = [d for g, _s, d, _l in rows if g.id == "MISSING-STORE"][0]
        if "0" in detail and "raised" not in detail:
            print("  ⛔ a missing store reported a number"); ok = False
        report(rows)
        print("\nSELF-CHECK:", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    return report(run())


if __name__ == "__main__":
    sys.exit(main())
