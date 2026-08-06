#!/usr/bin/env python3
"""Generate ``app/src/pages/parityBars/intraday5m.json`` — the INTRADAY parity fixture.

WHY IT EXISTS
-------------
``ramp200.json`` is 200 DAILY bars with ``t`` as ``"YYYY-MM-DD"``. VWAP is gated
to ``VWAP_TFS = {1,5,15,30,60}`` (``StockChart.jsx:559``), so a VWAP parity case
measured against the daily fixture renders an EMPTY chart on BOTH sides and
reports 0 changed pixels forever. That is a gate that cannot fail — the class the
whole parity runbook exists to prevent (B3 carry #4). Everything session-anchored
(VWAP now; session shading and anchored VWAP later) takes THIS fixture.

WHAT IT CONTAINS, and why each piece is load-bearing
----------------------------------------------------
Three EXTENDED-HOURS sessions, 04:00 → 20:00 ET inclusive, at 5-minute bars
(193 bars/session, 579 total), with ``t`` in NUMERIC UNIX SECONDS — ``computeVWAP``
does ``new Date(bar.t * 1000)``, and the daily fixture's ``"YYYY-MM-DD"`` strings
make that ``NaN``, so the whole column would vanish.

    Fri 2025-10-31   EDT (UTC-4)
    ── weekend gap, and US DST ends Sun 2025-11-02 02:00 local ──
    Mon 2025-11-03   EST (UTC-5)
    Tue 2025-11-04   EST (UTC-5)

Spec §9.1 makes two session cases mandatory, and on this window they are the SAME
phenomenon seen from both sides of a DST change:

  * **UTC-midnight crossing.** EDT is UTC-4, so 20:00 ET == 00:00 UTC the next
    day: Friday's closing bar starts a new UTC calendar day and ``computeVWAP``
    wipes its accumulator on the last bar of a session that never ended.
  * **DST transition.** EST is UTC-5, so the SAME boundary lands at 19:00 ET —
    an hour EARLIER, and thirteen bars INSIDE the post-market session. Identical
    wall-clock sessions, different split point: the boundary tracks the UTC
    offset, not the trading day.

And the consequence the two hourly golden cases could not show, because they are
too short to contain it: Monday's 19:00–20:00 ET bars have already opened UTC day
2025-11-04, so **Tuesday's 04:00 ET open is not a UTC-day boundary at all** and
never resets. The entire Tuesday session is computed on top of Monday evening's
post-market volume. That is the divergence Task 8's gate is measured against, and
it is why this fixture — unlike a regular-hours one — can tell UTC-day bucketing
apart from ET-session bucketing.

Regular trading hours (09:30–16:00 ET) are always inside ONE UTC day. That is
precisely why unit tests never caught the bug, and why an RTH-only fixture would
be worthless here.

DETERMINISM
-----------
A fixed-seed LCG, the same generator shape ``ramp200`` used, so this file
reproduces its output on any machine — every value identical, integer LCG state,
no float seeding (line endings are git's business: ``core.autocrlf`` stores LF
and checks out CRLF on Windows, exactly as it does for ``ramp200``).
Timestamps come from
HARD-CODED UTC offsets (``-4`` / ``-5``) rather than ``zoneinfo``, so the fixture
does not depend on a ``tzdata`` package being installed — but when ``zoneinfo``
IS available the offsets are cross-checked against it and a mismatch is fatal.
The independent check that lives in CI is
``app/src/pages/parityBars/intraday5m.test.js``, which reads the ET wall clock
back out of the platform tz database via ``Intl``.

⛔ DO NOT RE-RUN THIS once the fixture is committed. It is committed so its
provenance is auditable, not so it is convenient to replace: new bars invalidate
every parity number ever measured against it, and the golden fixture
``tests/fixtures/indicators/intraday5m_sessions.json`` carries a byte-for-byte
copy of these bars that both lanes assert against. It refuses to overwrite
without ``--force``.
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import pathlib
import sys

SEED = 20260802
OUT = pathlib.Path(__file__).resolve().parents[1] / "app/src/pages/parityBars/intraday5m.json"

# 04:00 ET (pre-market open) through 20:00 ET (post-market close), INCLUSIVE.
# The 20:00 bar is not decoration: on an EDT session it IS the UTC-midnight
# crossing. Drop it and the EDT half of spec §9.1's mandate disappears.
SESSION_START_MIN = 4 * 60
SESSION_END_MIN = 20 * 60
STEP_MIN = 5
# Regular trading hours, used only to shape the volume profile.
RTH_START_MIN = 9 * 60 + 30
RTH_END_MIN = 16 * 60

# (ET date, ET's offset from UTC in hours, session open, per-bar drift, POST-MARKET kick).
#
# Two things here are shaped ON PURPOSE, and a fixture without them would be
# green and worthless:
#
#   * the OVERNIGHT GAPS are large. The carry-over divergence is proportional to
#     the distance between one evening's post-market prints and the next
#     session's prices; on a gapless series the bug is worth a few cents and the
#     fixture barely sees what it exists to see.
#   * the POST-MARKET KICK moves each evening AWAY from its own session VWAP.
#     A UTC-day split collapses the accumulator to the split bar's typical price,
#     so if the evening drifts sideways at the session VWAP the split costs
#     nothing measurable — the first draft of this fixture reported 0.36 at the
#     Monday 19:00 ET split, which is inside the noise a reviewer would shrug at.
#     It is the same reason the hourly golden cases put a far-away print on their
#     final bar.
SESSIONS = (
    ("2025-10-31", -4, 100.00, +0.0160, +0.055),   # Fri, EDT — closes ~102.5, runs up to ~105 after hours
    ("2025-11-03", -5, 96.20, -0.0100, -0.065),    # Mon, EST — gaps DOWN, sells off after hours
    ("2025-11-04", -5, 108.40, +0.0140, +0.060),   # Tue, EST — gaps UP, runs up after hours
)

RTH_VOL = 180_000
EXT_VOL = 22_000


class LCG:
    """The same generator shape ``ramp200`` used. Deterministic across platforms:
    32-bit integer arithmetic only, no float state."""

    def __init__(self, seed: int) -> None:
        self.s = seed & 0xFFFFFFFF

    def next(self) -> float:
        self.s = (1664525 * self.s + 1013904223) & 0xFFFFFFFF
        return self.s / 0xFFFFFFFF


def _epoch(et_date: str, minute_of_day: int, utc_offset_h: int) -> int:
    """ET wall-clock → unix seconds, via an EXPLICIT offset.

    ``calendar.timegm`` reads the tuple as UTC, so subtracting ET's (negative)
    offset moves it to the real instant. Cross-checked against ``zoneinfo`` when
    that has a tz database to work with; a disagreement is fatal, never a warning.
    """
    y, m, d = (int(x) for x in et_date.split("-"))
    naive = dt.datetime(y, m, d, minute_of_day // 60, minute_of_day % 60)
    t = calendar.timegm(naive.timetuple()) - utc_offset_h * 3600
    try:
        import zoneinfo
        et = zoneinfo.ZoneInfo("America/New_York")
    except Exception:  # noqa: BLE001 — no tzdata (bare Windows CPython); skip the cross-check
        return t
    ref = int(naive.replace(tzinfo=et).timestamp())
    if ref != t:
        raise SystemExit(
            f"{et_date} {minute_of_day // 60:02d}:{minute_of_day % 60:02d} ET: declared offset "
            f"{utc_offset_h}h gives {t}, but the tz database says {ref}. The DST boundary in "
            f"SESSIONS is wrong, and a fixture with the wrong offsets pins the wrong bug."
        )
    return t


def build() -> dict:
    rng = LCG(SEED)
    bars: list[dict] = []
    for et_date, offset_h, open_price, drift, post_kick in SESSIONS:
        price = open_price
        for minute in range(SESSION_START_MIN, SESSION_END_MIN + 1, STEP_MIN):
            t = _epoch(et_date, minute, offset_h)
            step = (rng.next() - 0.5) * 0.30 + drift
            if minute >= RTH_END_MIN:
                step += post_kick
            o = round(price, 2)
            c = round(price + step, 2)
            hi = round(max(o, c) + rng.next() * 0.12, 2)
            lo = round(min(o, c) - rng.next() * 0.12, 2)
            # Extended-hours volume is thin, regular-hours is not. VWAP is
            # VOLUME-weighted, so a flat profile would hide the weighting the
            # indicator is entirely about — and it is exactly the thin evening
            # volume that leaks into the next session under UTC-day bucketing.
            base = RTH_VOL if RTH_START_MIN <= minute < RTH_END_MIN else EXT_VOL
            v = int(base * (0.6 + rng.next() * 0.8))
            bars.append({"t": t, "o": o, "h": hi, "l": lo, "c": c, "v": max(v, 1)})
            price = c
    return {
        "name": "intraday5m",
        "tf": "5",
        "note": (
            f"{len(bars)} synthetic FIVE-MINUTE bars for the chart parity gate, generated by "
            f"tools/gen_intraday_fixture.py (seed {SEED}). Three extended-hours sessions, "
            "04:00-20:00 ET inclusive: Fri 2025-10-31 (EDT), Mon 2025-11-03 and Tue 2025-11-04 "
            "(EST), so it spans a weekend gap AND the end of US DST. `t` is UNIX SECONDS because "
            "that is what /api/bars returns for intraday and because computeVWAP does "
            "new Date(t*1000). It exists because ramp200 is DAILY and VWAP_TFS gates VWAP to "
            "1/5/15/30/60, so a VWAP case against ramp200 renders an empty chart on both sides "
            "and reports 0 forever. On the EDT session computeVWAP's UTC-day bucketing splits at "
            "20:00 ET; on the EST sessions it splits an hour earlier at 19:00 ET, which also "
            "means Tuesday's 04:00 ET open is NOT a UTC-day boundary and its whole session is "
            "computed on top of Monday evening's post-market volume. DO NOT REGENERATE: new "
            "bars invalidate every parity number measured against this fixture, and "
            "tests/fixtures/indicators/intraday5m_sessions.json asserts a byte-for-byte copy of "
            "these bars in both lanes."
        ),
        "bars": bars,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing fixture (invalidates every parity number)")
    ap.add_argument("--out", default=str(OUT),
                    help="write somewhere else — for mutation runs, so the COMMITTED fixture "
                         "is never disturbed while a generator mutation is being scored")
    args = ap.parse_args(argv)

    out = pathlib.Path(args.out)
    if out.exists() and not args.force:
        raise SystemExit(
            f"{out} exists. Regenerating invalidates every parity number measured against it "
            f"(and the golden fixture's byte-for-byte copy of its bars); pass --force if you "
            f"mean it."
        )
    doc = build()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(doc['bars'])} bars)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
