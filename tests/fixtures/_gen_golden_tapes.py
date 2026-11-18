"""Generate the golden TAPES (inputs) and, with --regen, their GOLDEN outputs.

    python -m tests.fixtures._gen_golden_tapes            # write tapes only
    python -m tests.fixtures._gen_golden_tapes --regen    # tapes + goldens

Synthetic data only: symbols ZZTA/ZZTB/ZZTC, round made-up prices. The frames have
the exact shape of Massive stocks WS frames (JSON arrays of AM/A/T/status events).
Session: Thursday 2026-11-12, regular hours (09:30 ET = 14:30Z).

Regenerate goldens ONLY for an intended behaviour change, and say why in the commit.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

from tests import golden_tape_harness as H

T0 = int(datetime(2026, 11, 12, 14, 30, tzinfo=timezone.utc).timestamp() * 1000)   # 09:30:00 ET
MIN = 60_000


def T(sym, t, p, s, c=None):
    ev = {"ev": "T", "sym": sym, "i": "1", "x": 4, "p": p, "s": s, "t": t, "q": 1, "z": 3}
    if c is not None:
        ev["c"] = c
    return ev


def AGG(ev, sym, s, o, h, l, c, v, av, e=None):
    return {"ev": ev, "sym": sym, "v": v, "av": av, "op": o, "vw": c, "o": o, "c": c,
            "h": h, "l": l, "a": c, "z": 10, "s": s, "e": e if e is not None else s + (MIN if ev == "AM" else 1000)}


def frame(at, events):
    return {"at": at, "frame": json.dumps(events, separators=(",", ":"))}


def raw(at, text):
    return {"at": at, "frame": text}


def tape_minute_roll():
    """Trades through the 09:30 minute, the roll into 09:31, A aggregates (volume only),
    then the authoritative AM for 09:30 arriving 1.2s after its minute closed."""
    s = "ZZTA"
    rows = [
        frame(T0 + 150, [T(s, T0 + 100, 50.00, 100)]),
        frame(T0 + 180, [T(s, T0 + 120, 50.10, 200), T(s, T0 + 130, 49.95, 50)]),   # same throttle window
        frame(T0 + 1_050, [AGG("A", s, T0, 50.00, 50.10, 49.95, 50.05, 350, 12_350)]),
        frame(T0 + 30_000, [T(s, T0 + 29_900, 50.30, 300)]),
        frame(T0 + 59_990, [T(s, T0 + 59_950, 50.25, 100)]),
        frame(T0 + MIN + 40, [T(s, T0 + MIN + 10, 50.40, 400)]),                     # minute roll
        frame(T0 + MIN + 1_200, [AGG("AM", s, T0, 50.00, 50.30, 49.95, 50.25, 750, 12_750)]),
        frame(T0 + MIN + 1_300, [AGG("A", s, T0 + MIN, 50.40, 50.40, 50.40, 50.40, 400, 13_150)]),
        frame(T0 + 5 * MIN + 20, [T(s, T0 + 5 * MIN + 5, 50.50, 100)]),                # 5m bucket roll
    ]
    return {"symbols": [s], "universe": False}, rows


def tape_late_am_and_older_trade():
    """A late AM that DISAGREES with the trade-built minute (AM wins its own minute, D6/D7),
    and an out-of-order trade for an already-closed minute (older t: v2 subscribers only)."""
    s = "ZZTB"
    rows = [
        frame(T0 + 500, [T(s, T0 + 400, 20.00, 100)]),
        frame(T0 + 40_000, [T(s, T0 + 39_000, 20.20, 100)]),
        frame(T0 + MIN + 300, [T(s, T0 + MIN + 200, 20.10, 100)]),
        frame(T0 + MIN + 900, [T(s, T0 + 59_000, 19.80, 100)]),                       # older t (09:30)
        frame(T0 + MIN + 5_000, [AGG("AM", s, T0, 20.00, 20.25, 19.75, 20.05, 900, 5_900)]),
        frame(T0 + 2 * MIN + 100, [T(s, T0 + 2 * MIN + 50, 20.30, 100)]),
        frame(T0 + 2 * MIN + 2_000, [AGG("AM", s, T0 + MIN, 20.10, 20.10, 20.10, 20.10, 100, 6_000)]),
    ]
    return {"symbols": [s], "universe": False}, rows


def tape_conditions_and_noise():
    """Ghost-print conditions (odd lot 37: neither H/L nor last; 15: last only;
    30: H/L only; 12: session code, fully eligible), plus status acks, an error
    status, bad JSON, a single-object frame, an unknown ev, and malformed events."""
    s = "ZZTC"
    rows = [
        raw(T0 + 10, '[{"ev":"status","status":"success","message":"subscribed to: T.ZZTC"}]'),
        frame(T0 + 200, [T(s, T0 + 100, 10.00, 100)]),
        frame(T0 + 400, [T(s, T0 + 300, 10.90, 5, c=[37])]),        # odd lot spike: ignored
        frame(T0 + 600, [T(s, T0 + 500, 9.10, 100, c=[15])]),       # no H/L move, moves last
        frame(T0 + 800, [T(s, T0 + 700, 10.40, 100, c=[30])]),      # moves H/L, not last
        frame(T0 + 1_000, [T(s, T0 + 900, 10.05, 100, c=[12])]),    # session code: eligible
        raw(T0 + 1_100, "{not json"),
        raw(T0 + 1_200, json.dumps(T(s, T0 + 1_150, 10.10, 100), separators=(",", ":"))),   # bare object
        frame(T0 + 1_300, [{"ev": "Q", "sym": s, "bp": 10.0, "ap": 10.1}]),
        frame(T0 + 1_400, [{"ev": "T", "sym": s, "p": 10.2, "t": T0 + 1_350}]),          # no size: dropped
        frame(T0 + 1_500, [{"ev": "AM", "sym": s, "o": 1, "h": 1, "l": 1, "c": 1}]),     # no v/s: dropped
        raw(T0 + 1_600, '[{"ev":"status","status":"error","message":"synthetic error"}]'),
        frame(T0 + 1_700, ["not-a-dict", T(s, T0 + 1_650, 10.15, 100)]),
    ]
    return {"symbols": [s], "universe": False}, rows


def tape_universe():
    """Universe AM.* wildcard on: every AM goes to the universe hook; only ACTIVE
    symbols' AMs reach on_bar. T/A for the active symbol pass as usual."""
    a, z = "ZZTA", "ZZTZ"
    rows = [
        frame(T0 + 300, [T(a, T0 + 200, 50.00, 100)]),
        frame(T0 + MIN + 1_000, [AGG("AM", a, T0, 50.00, 50.00, 50.00, 50.00, 100, 100),
                                 AGG("AM", z, T0, 7.00, 7.10, 6.90, 7.05, 2_000, 2_000)]),
        frame(T0 + MIN + 1_100, [AGG("A", z, T0 + MIN, 7.05, 7.05, 7.05, 7.05, 10, 2_010)]),
    ]
    return {"symbols": [a], "active": [a], "universe": True}, rows


TAPES = {
    "minute_roll": tape_minute_roll,
    "late_am_and_older_trade": tape_late_am_and_older_trade,
    "conditions_and_noise": tape_conditions_and_noise,
    "universe": tape_universe,
}


def write_tapes() -> None:
    H.TAPE_DIR.mkdir(parents=True, exist_ok=True)
    for name, fn in TAPES.items():
        header, rows = fn()
        lines = [json.dumps(header, separators=(",", ":"))] + [json.dumps(r, separators=(",", ":")) for r in rows]
        (H.TAPE_DIR / f"{name}.tape.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    write_tapes()
    if "--regen" in sys.argv:
        for name in H.tape_names():
            H.write_golden(name, H.run_tape(name))
            print("golden:", name)
