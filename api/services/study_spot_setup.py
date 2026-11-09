"""SPOT THE SETUP (the owner, 2026-11-08: "SPOT THE KICKER SHOULD be SPOT THE SETUP"). The challenge shows one chart and a
few candles that look like the setup; the member taps the real one. It used to be the Kicker alone, with its look-alikes
found on the client by the owner's three Kicker rules. Every setup the course teaches now plays, so the look-alikes are
found HERE, with the same detectors the Hard pool is swept with (study_hard.SETUP_RULES), never invented:

  * the chart qualifies only when the setup fires on its last bar and nothing else does (study_hard.hard_eligible on a
    Yes item), so the real candle is never in doubt;
  * a look-alike is a candle in the visible window where the setup's own rules do NOT fire (every rule run, none raised)
    and whose shape is closest to the real candle's (same colour; the gap, the day's change, where it closed in its range
    and its volume against its average, each measured);
  * each look-alike comes back with those measurements beside the real candle's, so the card can say, in numbers, how it
    differs ("the gap was +0.4% against +4.9%").

No market fact is written here: every value is read off the bars. The key never leaves the server except as the premise
of this game (the last candle is the setup), and the attempt is still scored by /attempts against the bank's key.
"""
from __future__ import annotations

import logging
from typing import Optional

from api.services import study_hard
from api.services.pattern_engine.detectors.uct import uct_setups_common as U

log = logging.getLogger(__name__)

VIEW_DEFAULT = 90          # the challenge frames the last 90 bars on a desktop (55 on a phone)
MIN_FROM_LAST = 3          # a look-alike sits at least this many bars before the real candle
MIN_SPACING = 4            # and this far from another look-alike, so the chips never crowd
MAX_LOOKALIKES = 2
VOL_WINDOW = 50


def features(bars: list, i: int) -> Optional[dict]:
    """The candle at `i`, measured: gap from the prior close, the day's change, the body, where it closed in its range,
    its volume against the prior 50 sessions' average, and whether it closed green."""
    if i < 1 or i >= len(bars):
        return None
    b, p = bars[i], bars[i - 1]
    if not p["c"] or not b["o"]:
        return None
    rng = (b["h"] - b["l"]) or 1e-9
    vols = [x["v"] for x in bars[max(0, i - VOL_WINDOW):i] if x["v"] > 0]
    avg = (sum(vols) / len(vols)) if vols else 0.0
    return {
        "gap_pct": round((b["o"] / p["c"] - 1) * 100, 2),
        "chg_pct": round((b["c"] / p["c"] - 1) * 100, 2),
        "body_pct": round(abs(b["c"] - b["o"]) / b["o"] * 100, 2),
        "close_pos": round((b["c"] - b["l"]) / rng * 100, 1),
        "rvol": round(b["v"] / avg, 2) if avg > 0 else None,
        "green": b["c"] >= b["o"],
    }


def _distance(f: dict, r: dict) -> float:
    """How unlike the real candle a candidate looks (smaller is closer). The weights favour what the eye reads first."""
    d = abs(f["gap_pct"] - r["gap_pct"]) * 1.2 + abs(f["chg_pct"] - r["chg_pct"]) + abs(f["close_pos"] - r["close_pos"]) / 20.0
    if f.get("rvol") is not None and r.get("rvol") is not None:
        d += abs(f["rvol"] - r["rvol"]) * 0.8
    return d


def _fires(skill: str, bars: list, S: dict, i: int) -> Optional[bool]:
    """Does the setup fire on bar `i`? None when a rule raised (such a bar is never used)."""
    for rule in study_hard.SETUP_RULES.get(skill, ()):
        try:
            if rule(bars, S, i):
                return True
        except Exception as e:  # noqa: BLE001
            log.warning("study_spot_setup: %s rule raised at %s: %s", skill, i, e)
            return None
    return False


def lookalikes(raw_bars: list, skill: str, view: int = VIEW_DEFAULT, k: int = MAX_LOOKALIKES) -> Optional[dict]:
    """{"real": index, "real_features": {...}, "lookalikes": [{"i", "features"}...]} for a chart whose last bar is the
    setup and nothing else, or None when the chart cannot play (the setup does not fire there, another one does too, a
    rule could not run, or no candle in view looks enough like it)."""
    if skill not in study_hard.SETUP_RULES:
        return None
    bars = study_hard._as_bars(raw_bars)
    n = len(bars)
    if n < 10:
        return None
    if not study_hard.hard_eligible(True, skill, bars):
        return None
    fired, ok = study_hard.fired_on_last_bar(bars)
    if not ok or skill not in fired:
        return None
    try:
        S = U.series(bars)
    except Exception as e:  # noqa: BLE001
        log.warning("study_spot_setup: series failed: %s", e)
        return None
    real = features(bars, n - 1)
    if not real:
        return None
    pool = []
    for i in range(max(2, n - max(10, int(view))), n - MIN_FROM_LAST):
        f = features(bars, i)
        if not f or f["green"] != real["green"]:
            continue
        fires = _fires(skill, bars, S, i)
        if fires is not False:          # it fires (not a look-alike) or a rule failed (unknown): never used
            continue
        pool.append((_distance(f, real), i, f))
    pool.sort(key=lambda x: (x[0], -x[1]))
    picked: list[tuple[int, dict]] = []
    for _, i, f in pool:
        if all(abs(i - j) >= MIN_SPACING for j, _ in picked):
            picked.append((i, f))
        if len(picked) >= k:
            break
    if not picked:
        return None
    picked.sort()
    return {"real": n - 1, "real_features": real, "lookalikes": [{"i": i, "features": f} for i, f in picked]}
