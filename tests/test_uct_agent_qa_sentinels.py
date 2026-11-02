"""UCT Agent program, agent-qa: SENTINEL DETECTION that cannot collide with timings, ids or hex.

⚰️ Measured on master f1342137b1 (gate run 41372562071): modelIsolation.test.jsx matched the sentinel `13579` as a
plain SUBSTRING of a JSON blob, and trace.js holds `t0: performance.now()`, a float such as 213579.83. A timing
reported a leak.

The fix, shared by every QA isolation rail (this module for Python, app/src/agent/qa/sentinels.js for the browser):
  * numeric sentinels are long NON-INTEGERS (no integer timing, count, id or port can equal one);
  * a numeric sentinel matches only as an EXACT NUMBER VALUE, or as a WHOLE TOKEN inside a string (not preceded by
    a word character or '.', not followed by a word character or '.<digit>');
  * a string sentinel carries letters a timing cannot (still a substring match: it is the member-visible label).
This file also carries the regression: timings containing every sentinel's digits read clean; the sentinels
themselves, in values and in prose, are still caught.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable

SENT_NUM = "987.654321"          # a composite / rating value
SENT_INT = "13579.2468"          # a count / reading value (the name is kept from the first version; it is not an integer)
SENT_STR = "ISO-SENTINEL-7Q"
SENTINELS = (SENT_NUM, SENT_INT, SENT_STR)
_NUMERIC = re.compile(r"^-?\d+(\.\d+)?$")


def _token(s: str) -> re.Pattern:
    return re.compile(r"(?<![0-9A-Za-z_.])" + re.escape(s) + r"(?![0-9A-Za-z_]|\.\d)")


def _walk(v: Any, nums: list, strs: list) -> None:
    if isinstance(v, bool) or v is None:
        return
    if isinstance(v, (int, float)):
        nums.append(v)
    elif isinstance(v, str):
        strs.append(v)
    elif isinstance(v, dict):
        for k, x in v.items():
            strs.append(str(k))
            _walk(x, nums, strs)
    elif isinstance(v, (list, tuple)):
        for x in v:
            _walk(x, nums, strs)
    else:
        strs.append(str(v))


def leaks(obj: Any, sentinels: Iterable[str] = SENTINELS) -> list[str]:
    """The sentinels present in `obj` (any JSON-able value, or a string such as a dumped request)."""
    plain = json.loads(json.dumps(obj, default=str))
    nums: list = []
    strs: list = []
    _walk(plain, nums, strs)
    found = []
    for s in sentinels:
        if _NUMERIC.match(s):
            hit = any(float(n) == float(s) for n in nums) or any(_token(s).search(t) for t in strs)
        else:
            hit = any(s in t for t in strs)
        if hit:
            found.append(s)
    return found


# ── the regression ──────────────────────────────────────────────────────────────────────────────────────────
def test_timings_ids_and_hex_carrying_every_sentinels_digits_read_CLEAN():
    noise = {"t0": 213579.83, "t1": 1213579.2468, "ms": 13579, "ms2": 2468, "perf": 9987.6543211, "x": 987.654,
             "id": "a1b2c3d4-13579-2468-9876-54321abcdef0", "hex": "0x987654321", "uuid": "987654321-e5f6",
             "ver": "v13579.24689", "text": "took 213579.2468 ms at 1987.654321s; run 13579.24681"}
    assert leaks(noise) == []
    assert leaks(json.dumps(noise)) == [], "the same noise as one dumped string"


def test_CONTROL_the_sentinels_themselves_are_caught_as_values_and_in_prose():
    assert leaks({"composite": float(SENT_NUM)}) == [SENT_NUM]
    assert leaks({"reading": float(SENT_INT)}) == [SENT_INT]
    assert leaks(f"NVDA rating {SENT_NUM}; new highs {SENT_INT}.") == [SENT_NUM, SENT_INT]   # a sentence-final '.'
    assert leaks({"label": f"Ratings {SENT_STR}"}) == [SENT_STR]
    assert leaks(json.dumps({"v": float(SENT_NUM)})) == [SENT_NUM], "inside a dumped request body"
    assert leaks({"s": f"({SENT_NUM})"}) == [SENT_NUM]
