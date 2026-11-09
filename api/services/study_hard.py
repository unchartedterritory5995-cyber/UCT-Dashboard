"""Hard mode's LAST-BAR SWEEP (owner, batch 21, 2026-11-06, on an AAPL chart whose Launchpad key said No and whose
screen then said "Nothing fired here": "AAPL in this example IS an oops reversal! We cannot have incorrect examples
and explanations!"). He was right, and so was the bank: the UCT Oops Reversal detector fires on that bar (opened
under the prior close, undercut the prior low, closed back over the prior close); the Launchpad detector does not.
A bank item's key answers ONE question - does ITS setup fire on the last bar - while Hard mode asks "what fired?"
across seven setups, so a key alone can never back the "Nothing fired" card.

The rule here: a chart plays in Hard mode only when every one of the seven setup detectors agrees with the card
Hard mode would credit:
  * a Yes item: no OTHER setup fires on its last bar (naming its own setup is the one right answer);
  * a No item: NOTHING fires on its last bar ("Nothing fired" is the one right answer).
Anything else (another setup fires; a detector could not run) is left out of the Hard pool. The sweep is the pattern
engine's own per-bar rules (api/services/pattern_engine/detectors/uct), the same code the bank was found with; no
model, no new market fact. The bear gap has no engine detector: its rule is the bank's own finder
(scripts/study/find_bear_gap_examples.py) read mechanically, the hard conditions only.

Public surface: `fired_on_last_bar(bars)`, `hard_eligible(key_yes, skill_id, bars)`, `item_eligible(item_id)`
(cached per item id and version; the router filters a `hard` skill session's bank through it)."""
from __future__ import annotations

import logging
from typing import Callable, Optional

from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.detectors.uct import (
    uct_gap_support, uct_hve, uct_kicker, uct_launch_pad, uct_launch_pad_v4, uct_oops_reversal, uct_slingshot,
)

log = logging.getLogger(__name__)

# the bear gap finder's hard conditions (find_bear_gap_examples.py: MAX_FROM_HIGH_PCT, MIN_GAP_PCT, MIN_DAY_PCT, MIN_RVOL)
BEAR_MAX_FROM_HIGH_PCT = 30.0
BEAR_MIN_GAP_PCT = 5.0
BEAR_MIN_DAY_PCT = 6.0
BEAR_MIN_RVOL = 2.0
BEAR_HIGH_LOOKBACK = 250
BEAR_TOP_WITHIN = 80


def _pct(a: float, b: float) -> float:
    return (a / b - 1.0) * 100.0 if b else 0.0


def bear_gap_fires(bars: list, S: dict, i: int) -> Optional[dict]:
    """The bank's bear gap off the highs, hard conditions only: a true gap down (the day's high under the prior low),
    the open 5%+ under the prior close, volume 2x the 50-day average, a 6%+ down close, off a recent top (the 250-session
    closing high within the prior 80 sessions and the prior close within 30% of it) and the first 3%+ gap down since
    that top. Scores and the after-window are the finder's business, not a reason to fire."""
    if i < 2 or i >= len(bars):
        return None
    b, p = bars[i], bars[i - 1]
    if not (U.valid_bar(b) and U.valid_bar(p)):
        return None
    j = i - 1
    v50 = S["v50"][j] if j < len(S["v50"]) else None
    if not v50:
        return None
    gap_pct = _pct(b["o"], p["c"])
    day_pct = _pct(b["c"], p["c"])
    true_gap = b["h"] < p["l"]
    vol_2x = S["v"][i] >= BEAR_MIN_RVOL * v50
    if not (true_gap and gap_pct <= -BEAR_MIN_GAP_PCT and vol_2x and day_pct <= -BEAR_MIN_DAY_PCT):
        return None
    lo = max(0, i - BEAR_HIGH_LOOKBACK)
    top_i = max(range(lo, i), key=lambda k: bars[k]["c"])
    hi_close = bars[top_i]["c"]
    recent_top = (i - top_i) <= BEAR_TOP_WITHIN
    at_highs = recent_top and _pct(p["c"], hi_close) >= -BEAR_MAX_FROM_HIGH_PCT
    if not at_highs:
        return None
    for k in range(top_i + 1, i):
        pk, bk = bars[k - 1], bars[k]
        if bk["o"] < pk["l"] * 0.98 and _pct(bk["o"], pk["c"]) <= -3.0:
            return None       # not the first crack since the top
    return {"gap_pct": round(gap_pct, 2), "day_pct": round(day_pct, 2), "top_idx": top_i}


def williams_oops(bars: list, S: dict, i: int) -> Optional[dict]:
    """The Williams Oops the bank's Oops ruling names beside the scanner version ("opens below the prior LOW and rallies
    back above it"): counted as an Oops so a chart showing one is never called "Nothing fired"."""
    if i < 1:
        return None
    b, p = bars[i], bars[i - 1]
    if not (U.valid_bar(b) and U.valid_bar(p)):
        return None
    return {"williams": True} if (b["o"] < p["l"] and b["c"] > p["l"]) else None


def volume_edge(bars: list, S: dict, i: int) -> Optional[dict]:
    """The volume edge on the history the CHART shows: the session's volume beats every prior session in the window
    (at most the prior 252, at least 20) and it closes over $3 (uct_setups_common.hve_bar's a1). The engine's HVE
    detector also wants 190 prior sessions, which a 120-bar bank window never has; a member judges the window in front
    of them, so a record on the window counts here (a 252-session record is a record on any shorter window too). An UP
    day only: the bank's High Volume Edge ruling is "an up day on a volume that DWARFS everything before it"."""
    hb = U.hve_bar(bars, S, i)
    # the bank's ruling: "an up day on a volume that DWARFS everything before it" (a record-volume DOWN day is not one)
    return hb if (hb and hb.get("a1_252") and hb.get("up_day")) else None


#: skill id -> the per-bar rules that mean "this setup fires here" (any one of them firing counts). Each is at least as
#: generous as the engine's own detector, so the sweep errs toward leaving a chart out, never toward a wrong card.
SETUP_RULES: dict[str, tuple[Callable, ...]] = {
    "setup.family3.kicker": (uct_kicker.evaluate,),
    "setup.family1.launchpad": (uct_launch_pad.evaluate, uct_launch_pad_v4.evaluate),
    "setup.family4.slingshot": (uct_slingshot.evaluate,),
    "setup.family4.oops": (uct_oops_reversal.evaluate, williams_oops),
    "setup.family3.hve": (uct_hve.evaluate, volume_edge),
    "setup.family3.gap_support": (uct_gap_support.evaluate,),
    "setup.family3.bear_gap": (bear_gap_fires,),
}
HARD_SKILLS = tuple(SETUP_RULES)


def _as_bars(bars: list) -> list:
    out = []
    for b in bars or []:
        try:
            out.append({"t": b.get("t"), "o": float(b["o"]), "h": float(b["h"]), "l": float(b["l"]),
                        "c": float(b["c"]), "v": float(b.get("v") or 0.0)})
        except (KeyError, TypeError, ValueError):
            return []
    return out


def fired_on_last_bar(bars: list) -> tuple[set[str], bool]:
    """(the skill ids whose setup fires on the LAST bar, every rule ran). The second value is False when a rule raised
    or the bars could not be read: the caller must treat such a chart as unknown, never as 'nothing fired'."""
    bars = _as_bars(bars)
    if len(bars) < 5:
        return set(), False
    i = len(bars) - 1
    try:
        S = U.series(bars)
    except Exception as e:  # noqa: BLE001
        log.warning("study_hard: series failed: %s", e)
        return set(), False
    fired: set[str] = set()
    ok = True
    for skill, rules in SETUP_RULES.items():
        for rule in rules:
            try:
                if rule(bars, S, i):
                    fired.add(skill)
                    break
            except Exception as e:  # noqa: BLE001
                log.warning("study_hard: %s rule %s raised: %s", skill, getattr(rule, "__module__", rule), e)
                ok = False
    return fired, ok


def hard_eligible(key_yes: bool, skill_id: str, bars: list) -> bool:
    """May this chart be asked "what fired on the last candle?" with its key as the answer? A Yes item: nothing else fires;
    a No item: nothing fires at all. A sweep that did not complete makes the chart ineligible."""
    fired, ok = fired_on_last_bar(bars)
    if not ok:
        return False
    if key_yes:
        return not (fired - {skill_id})
    return not fired


def key_is_yes(answer_json) -> Optional[bool]:
    """The bank's Yes / No key of a spot item; None when the key is not a yes/no."""
    a = answer_json
    if isinstance(a, dict):
        a = a.get("answer", a.get("correct"))
    if isinstance(a, bool):
        return a
    s = str(a or "").strip().lower()
    if s in ("yes", "y", "true", "1"):
        return True
    if s in ("no", "n", "false", "0"):
        return False
    return None


_CACHE: dict[tuple[str, int], bool] = {}
_CACHE_MAX = 6000


def item_eligible(item_id: str, *, store=None) -> bool:
    """The sweep for one bank item (approved, with a chart, a yes/no key, one of the seven setups), cached per
    (id, version). Anything that cannot be swept is ineligible."""
    from api.services import study_store as _ss
    st = store or _ss
    item = st.get_item_full(item_id)
    if not item or item.get("type") != "spot" or item.get("skill_id") not in SETUP_RULES:
        return False
    key = (item_id, int(item.get("version") or 1))
    hit = _CACHE.get(key)
    if hit is not None:
        return hit
    yes = key_is_yes(item.get("answer_json"))
    vis = st.get_visible_bars(item_id)
    bars = (vis or {}).get("bars") or []
    ok = yes is not None and bool(bars) and hard_eligible(yes, item["skill_id"], bars)
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.clear()
    _CACHE[key] = ok
    return ok


def clear_cache() -> None:
    _CACHE.clear()


# ── the setup's rule, in the bank's own words ─────────────────────────────────
# A near-miss chart's lesson is a template ("Launchpad: the firm's detector does not fire on the last bar of this
# chart. <why not>") with no rule in it, so the reveal also carries the setup's definition AS THE BANK WRITES IT in
# the approved lessons of that setup ("<Name>: <definition> Here <this chart>"): the definition is the text between the
# name and the chart's own "Here" sentence, the most common one wins, the provenance stamps are left on for the client
# to lift (lesson.js). Nothing is written here; it is the owner-ruled text, read back.
import re as _re
import time as _time
from collections import Counter as _Counter

_NAMED = _re.compile(r"^([A-Z][A-Za-z0-9 ()'&/-]{1,48}?):\s+(?=\S)")
_HERE = _re.compile(r"(?:^|(?<=[.!?;:]))\s+Here\b")
_RULE_TTL_S = 600
_RULE_CACHE: dict[str, tuple[float, Optional[dict]]] = {}


def _definition(lesson: str) -> Optional[tuple[str, str]]:
    t = " ".join(str(lesson or "").split())
    m = _NAMED.match(t)
    if not m or "detector" in t[:160].lower():
        return None
    body = t[m.end():]
    cut = [x.start() for x in _HERE.finditer(body)]
    if cut:
        body = body[:cut[-1]]
    body = body.strip()
    return (m.group(1).strip(), body) if len(body) > 40 else None


def setup_rule(skill_id: str, *, store=None) -> Optional[dict]:
    """{"name", "text"}: the definition the approved lessons of this setup share, or None."""
    now = _time.time()
    hit = _RULE_CACHE.get(skill_id)
    if hit and now - hit[0] < _RULE_TTL_S:
        return hit[1]
    from api.services import study_store as _ss
    st = store or _ss
    try:
        import contextlib
        with contextlib.closing(st._connect()) as c:
            rows = c.execute("SELECT lesson_text FROM study_items WHERE skill_id=? AND review_status=? AND type='spot'",
                             (skill_id, st.STATUS_APPROVED)).fetchall()
    except Exception as e:  # noqa: BLE001
        log.warning("study_hard: setup_rule(%s) failed: %s", skill_id, e)
        return None
    defs = [d for d in (_definition(r[0]) for r in rows) if d]
    out = None
    if defs:
        (name, text), _n = _Counter(defs).most_common(1)[0]
        out = {"name": name, "text": text}
    _RULE_CACHE[skill_id] = (now, out)
    return out


def clear_rule_cache() -> None:
    _RULE_CACHE.clear()
